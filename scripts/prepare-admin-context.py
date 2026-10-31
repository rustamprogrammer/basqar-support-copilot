"""Join private player texts with administrator replies for reference labeling."""

import gzip
import json
import sys
import tarfile
from pathlib import Path


def main():
    if len(sys.argv) != 4:
        raise SystemExit("Usage: prepare-admin-context.py ARCHIVE FULL_SAMPLE OUTPUT")
    archive_path, sample_path, output_path = map(Path, sys.argv[1:])
    sample = [json.loads(line) for line in sample_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if len(sample) != 1299 or len({r["id"] for r in sample}) != 1299:
        raise ValueError("Unexpected sample size or duplicate IDs")
    wanted = {row["id"]: row for row in sample}
    replies = {}
    with tarfile.open(archive_path, "r:gz") as archive:
        for origin, name in (("validation", "handout/tickets_valid.jsonl"),
                             ("train_kk", "handout/tickets_train.jsonl.gz")):
            source = archive.extractfile(name)
            stream = gzip.GzipFile(fileobj=source) if name.endswith(".gz") else source
            for line in stream:
                if not line.strip():
                    continue
                ticket = json.loads(line)
                if origin == "train_kk" and ticket.get("lang") != "kk":
                    continue
                identifier = str(ticket.get("ticket_id") or "")
                if identifier not in wanted:
                    continue
                if identifier in replies:
                    raise ValueError("Duplicate source ID")
                admin = next((m["text"] for m in ticket.get("messages", [])
                              if m.get("role") == "admin" and isinstance(m.get("text"), str)
                              and m["text"].strip()), "")
                replies[identifier] = admin
            stream.close()
            source.close()
    if len(replies) != len(sample):
        raise ValueError("Missing source IDs")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("x", encoding="utf-8", newline="\n") as file:
        for row in sample:
            file.write(json.dumps({"id": row["id"], "player": row["text"], "admin": replies[row["id"]],
                                   "lang": row["lang"], "origin": row["origin"]},
                                  ensure_ascii=False, separators=(",", ":")) + "\n")
    print(json.dumps({"rows": len(sample), "admin_replies": sum(bool(text) for text in replies.values()),
                      "missing_replies": sum(not text for text in replies.values()),
                      "output": str(output_path)}))


if __name__ == "__main__":
    main()
