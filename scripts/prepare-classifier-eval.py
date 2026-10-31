"""Deterministic, disjoint evaluation sampling; no network or model access."""

import argparse
from collections import Counter
import gzip
import hashlib
import json
from pathlib import Path
import sys
import tarfile
import unicodedata


NORMALIZATION = "nfkc-casefold-strip-format-collapse-whitespace-v1"
SOURCES = {
    "validation": "handout/tickets_valid.jsonl",
    "train": "handout/tickets_train.jsonl.gz",
}


def normalized_text(text):
    # Keep spelling, punctuation, and language intact; only presentation differs.
    normalized = unicodedata.normalize("NFKC", text).casefold()
    normalized = "".join(c for c in normalized if unicodedata.category(c) != "Cf")
    return " ".join(normalized.split())


def digest(value):
    if isinstance(value, str):
        value = value.encode("utf-8")
    return hashlib.sha256(value).hexdigest()


def counts(rows, field):
    return dict(sorted(Counter(row[field] for row in rows).items()))


def origin_language_counts(rows):
    return {origin: counts([r for r in rows if r["origin"] == origin], "lang")
            for origin in ("validation", "train")}


def load_exclusions(paths):
    ids, texts, metadata = set(), set(), []
    for path in paths:
        source_bytes = Path(path).read_bytes()
        rows = 0
        for line in source_bytes.decode("utf-8-sig").splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            if not isinstance(row, dict):
                raise ValueError("Excluded sample rows must be objects.")
            identifier = row.get("id", row.get("ticket_id"))
            text = row.get("text", row.get("original"))
            if not isinstance(identifier, str) or not identifier or not isinstance(text, str) or not text.strip():
                raise ValueError("Excluded samples require nonempty string id and text fields.")
            ids.add(identifier)
            texts.add(normalized_text(text))
            rows += 1
        metadata.append({"rows": rows, "sha256": digest(source_bytes)})
    return ids, texts, metadata


def read_candidates(archive, origin, prompt, excluded_ids, excluded_texts):
    candidates = []
    exclusions = Counter()
    language_counts, kind_counts = Counter(), Counter()
    total = 0
    source_hash = hashlib.sha256()
    source = archive.extractfile(SOURCES[origin])
    if source is None:
        raise ValueError("Required dataset archive member is missing.")
    stream = gzip.GzipFile(fileobj=source) if origin == "train" else source
    try:
        for line in stream:
            source_hash.update(line)
            if not line.strip():
                continue
            ticket = json.loads(line)
            total += 1
            language = str(ticket.get("lang") or "und")
            kind = str(ticket.get("kind") or "")
            language_counts[language] += 1
            kind_counts[kind] += 1
            if origin == "train" and language != "kk":
                exclusions["not_train_kazakh"] += 1
                continue
            identifier = str(ticket.get("ticket_id") or "")
            if not identifier:
                exclusions["missing_id"] += 1
                continue
            message = next((message for message in ticket.get("messages", [])
                            if message.get("role") == "player"
                            and isinstance(message.get("text"), str)
                            and message["text"].strip()), None)
            if message is None:
                exclusions["no_player_text"] += 1
                continue
            text = message["text"]
            # Match the classifier's JavaScript UTF-16 length limit.
            if len(text.encode("utf-16-le")) // 2 > 2000:
                exclusions["too_long"] += 1
                continue
            if '"' + text.strip() + '"' in prompt:
                exclusions["prompt_example"] += 1
                continue
            normalized = normalized_text(text)
            if not normalized:
                exclusions["empty_normalized_text"] += 1
                continue
            if identifier in excluded_ids:
                exclusions["previous_id"] += 1
                continue
            if normalized in excluded_texts:
                exclusions["previous_normalized_text"] += 1
                continue
            candidates.append({
                "id": identifier, "text": text, "lang": language, "kind": kind,
                "origin": origin, "expected_box": None, "label_source": "unlabeled",
                "normalized_text_sha256": digest(normalized),
                "_normalized": normalized,
                "_sample_hash": digest("grand-eval-v1:" + identifier),
            })
    finally:
        stream.close()
        source.close()
    metadata = {
        "dataset": SOURCES[origin], "dataset_sha256": source_hash.hexdigest(),
        "hash_content": "decompressed JSONL bytes", "total": total,
        "lang_counts": dict(sorted(language_counts.items())),
        "kind_counts": dict(sorted(kind_counts.items())),
        "excluded": dict(sorted(exclusions.items())),
        "eligible_before_dedup": len(candidates),
    }
    return candidates, metadata


def prepare(args):
    if not 1 <= args.sample_size <= 100 or not 0 <= args.per_language <= 33:
        raise ValueError("Sample size must be 1-100 and per-language quota 0-33.")
    if args.include_train_kazakh and not args.per_language:
        raise ValueError("Train Kazakh fallback requires an explicit per-language diagnostic quota.")
    out = Path(args.output_directory)
    sample_path, metadata_path = out / "validation-sample.jsonl", out / "validation-metadata.json"
    if not args.availability_only and (sample_path.exists() or metadata_path.exists()):
        raise ValueError("Evaluation output already exists; existing samples and labels are never overwritten.")
    excluded_ids, excluded_texts, exclusion_files = load_exclusions(args.exclude_sample)
    prompt = Path(args.prompt).read_text(encoding="utf-8-sig")
    origins = ["validation", "train"] if args.include_train_kazakh else ["validation"]
    eligible, sources, seen_ids, seen_texts = [], {}, set(), set()
    with tarfile.open(args.archive, "r:gz") as archive:
        for origin in origins:
            candidates, source_metadata = read_candidates(archive, origin, prompt, excluded_ids, excluded_texts)
            duplicate_ids, duplicate_texts = 0, 0
            # Validation always wins over train, then the fixed hash breaks ties.
            for row in sorted(candidates, key=lambda row: row["_sample_hash"]):
                if row["id"] in seen_ids:
                    duplicate_ids += 1
                    continue
                if row["_normalized"] in seen_texts:
                    duplicate_texts += 1
                    continue
                seen_ids.add(row["id"])
                seen_texts.add(row["_normalized"])
                eligible.append(row)
            source_metadata["excluded"]["duplicate_id"] = duplicate_ids
            source_metadata["excluded"]["duplicate_normalized_text"] = duplicate_texts
            source_metadata["eligible"] = sum(row["origin"] == origin for row in eligible)
            sources[origin] = source_metadata
    if args.per_language:
        selected = []
        for language in ("ru", "kk", "uz"):
            selected.extend([row for row in eligible if row["lang"] == language][:args.per_language])
        sample_method = "Language diagnostic: validation first, then optional train-only Kazakh shortfall; SHA-256(grand-eval-v1:ticket_id) order within each origin; first nonempty player message only."
        sampling_note = "Not representative of overall traffic. Source language labels are heuristic. Train rows are a separate diagnostic, never validation or independent gold accuracy."
    else:
        selected = eligible[:args.sample_size]
        sample_method = "First eligible unique messages sorted by SHA-256(grand-eval-v1:ticket_id); first nonempty player message only."
        sampling_note = "Deterministic validation sample after exclusions and text deduplication; exclusions change the original traffic distribution."
    sample = [{key: value for key, value in row.items() if not key.startswith("_")} for row in selected]
    sample_text = "".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in sample)
    sample_bytes = sample_text.encode("utf-8")
    selected_texts = {row["_normalized"] for row in selected}
    selected_ids = {row["id"] for row in selected}
    if selected_ids & excluded_ids or selected_texts & excluded_texts or len(selected_texts) != len(sample):
        raise ValueError("Independent sample overlap invariant failed.")
    available_counts = origin_language_counts(eligible)
    metadata = {
        "dataset": SOURCES["validation"],
        "dataset_sha256": sources["validation"]["dataset_sha256"],
        "total": sources["validation"]["total"],
        "kind_counts": sources["validation"]["kind_counts"],
        "lang_counts": sources["validation"]["lang_counts"],
        "sources": sources, "normalization": NORMALIZATION,
        "previous_sample_files": exclusion_files,
        "previous_unique_ids": len(excluded_ids), "previous_unique_normalized_texts": len(excluded_texts),
        "eligible": len(eligible), "available_origin_lang_counts": available_counts,
        "sample_size": len(sample), "sample_method": sample_method,
        "requested_per_language": args.per_language,
        "sampling_note": sampling_note,
        "sample_lang_counts": counts(sample, "lang"),
        "sample_kind_counts": counts(sample, "kind"),
        "sample_origin_lang_counts": origin_language_counts(sample),
        "validation_language_shortfall": {lang: max(0, args.per_language - available_counts["validation"].get(lang, 0))
                                          for lang in ("ru", "kk", "uz")} if args.per_language else {},
        "sample_sha256": digest(sample_bytes),
        "previous_id_overlap": len(selected_ids & excluded_ids),
        "previous_normalized_text_overlap": len(selected_texts & excluded_texts),
        "duplicate_normalized_texts_in_sample": len(sample) - len(selected_texts),
        "gold_labels_available": False,
        "label_note": "No ground truth for the three new routing classes is supplied. Independent review required.",
        "output_written": not args.availability_only,
        "api_calls": 0,
    }
    if not args.availability_only:
        if not sample:
            raise ValueError("No eligible sample remains; no output written.")
        out.mkdir(parents=True, exist_ok=True)
        with sample_path.open("xb") as file:
            file.write(sample_bytes)
        with metadata_path.open("x", encoding="utf-8", newline="\n") as file:
            json.dump(metadata, file, ensure_ascii=False, indent=2)
            file.write("\n")
    return metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--output-directory", required=True)
    parser.add_argument("--sample-size", type=int, default=100)
    parser.add_argument("--per-language", type=int, default=0)
    parser.add_argument("--exclude-sample", action="append", default=[])
    parser.add_argument("--include-train-kazakh", action="store_true")
    parser.add_argument("--availability-only", action="store_true")
    args = parser.parse_args()
    try:
        metadata = prepare(args)
    except (OSError, ValueError, KeyError, tarfile.TarError) as error:
        # Do not let malformed private data appear in exception tracebacks.
        print(json.dumps({"error_type": type(error).__name__, "preparation_failed": True, "api_calls": 0}), file=sys.stderr)
        return 1
    print(json.dumps(metadata, ensure_ascii=True, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
