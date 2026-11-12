#!/usr/bin/env python3
"""Refresh or verify the append proof's exact SQL without accessing a database."""

import argparse
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "crates/channel_change_db_utils/src/append.rs"
PROOF = Path(__file__).with_name("channel_change_append_plans.sql")


def source_queries():
    queries = re.findall(r'sqlx::query(?:_scalar)?!\(\s*r#"(.*?)"#', SOURCE.read_text(), re.S)
    if len(queries) != 2:
        raise ValueError("expected the scalar and activity append queries")
    return zip(("append_scalar", "append_activity"), queries)


def synchronized(proof):
    for name, query in source_queries():
        pattern = rf"(PREPARE {name}(?: \([^\n]+\))? AS).*?;(?=\n)"
        matches = list(re.finditer(pattern, proof, re.S))
        if len(matches) != 1:
            raise ValueError(f"expected exactly one PREPARE {name} block")
        match = matches[0]
        separator = "" if query.startswith("\n") else " "
        proof = proof[:match.start()] + match.group(1) + separator + query + ";" + proof[match.end():]
    return proof


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if the proof SQL is stale")
    args = parser.parse_args()
    original = PROOF.read_text()
    expected = synchronized(original)
    if args.check:
        if original != expected:
            parser.exit(1, "append proof SQL differs from append.rs; run this script without --check\n")
        print("PASS: both append proof queries match append.rs byte-for-byte")
    else:
        PROOF.write_text(expected)
        print("Updated both append proof queries from append.rs")


if __name__ == "__main__":
    main()
