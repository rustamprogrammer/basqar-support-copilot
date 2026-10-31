"""Extract the 1,000 validation tickets plus every train Kazakh ticket for a local full run."""

import gzip
import hashlib
import json
import sys
import tarfile
from collections import Counter
from pathlib import Path


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Usage: prepare-full-classifier-eval.py ARCHIVE OUTPUT_DIR")
    archive_path, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    sample_path, metadata_path = out / "full-sample.jsonl", out / "sample-metadata.json"
    if sample_path.exists() or metadata_path.exists():
        raise SystemExit("Output already exists")
    rows, counts = [], Counter()
    with tarfile.open(archive_path, "r:gz") as archive:
        for origin, name in (("validation", "handout/tickets_valid.jsonl"),
                             ("train_kk", "handout/tickets_train.jsonl.gz")):
            stream = archive.extractfile(name)
            source = gzip.GzipFile(fileobj=stream) if name.endswith(".gz") else stream
            for line in source:
                if not line.strip():
                    continue
                ticket = json.loads(line)
                if origin == "train_kk" and ticket.get("lang") != "kk":
                    continue
                text = next((message["text"] for message in ticket.get("messages", [])
                             if message.get("role") == "player"
                             and isinstance(message.get("text"), str) and message["text"].strip()), None)
                if not text:
                    raise ValueError("Ticket without player text")
                if len(text.encode("utf-16-le")) // 2 > 2000:
                    raise ValueError("Player text exceeds classifier input limit")
                row = {"id": str(ticket["ticket_id"]), "text": text, "lang": str(ticket.get("lang") or "und"),
                       "origin": origin, "expected_box": None, "label_source": "unlabeled"}
                rows.append(row)
                counts[origin] += 1
                counts[f"lang:{row['lang']}"] += 1
            source.close()
            stream.close()
    if counts["validation"] != 1000 or counts["train_kk"] != 299:
        raise ValueError("Unexpected archive composition")
    data = "".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in rows).encode()
    with sample_path.open("xb") as file:
        file.write(data)
    with metadata_path.open("x", encoding="utf-8") as file:
        json.dump({"sample_sha256": hashlib.sha256(data).hexdigest(), "count": len(rows),
                   "origins": {key: counts[key] for key in ("validation", "train_kk")},
                   "languages": {key[5:]: value for key, value in counts.items() if key.startswith("lang:")},
                   "gold_labels_available": False,
                   "note": "First nonempty player text; kind/verdict are not gold labels for three routing boxes."}, file, indent=2)
    print(json.dumps({"sample": str(sample_path), "rows": len(rows),
                      "unique_texts": len({row["text"].strip() for row in rows}), "api_calls": 0}))


if __name__ == "__main__":
    main()
