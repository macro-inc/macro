#!/usr/bin/env python3
"""Verify synthetic-delay writers preserve their old/current Rust source bodies."""

from __future__ import annotations

import difflib
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
REPO_PATH = Path("crates/messages/src/outbound/pg_message_repo.rs")
BASELINE_PATH = REPO_PATH.parent / "pg_message_repo/test/baseline.rs"
DELAYED_PATH = REPO_PATH.parent / "pg_message_repo/test/benchmark/delayed.rs"
BASE_COMMIT = "354da677b5"


class AuditError(Exception):
    """A writer differs beyond the explicitly permitted benchmark additions."""


def tokens(source: str) -> list[str]:
    """Discard Rust trivia while preserving literal contents and punctuation."""
    result = []
    position = 0
    while position < len(source):
        if source[position].isspace():
            position += 1
            continue
        if source.startswith("//", position):
            newline = source.find("\n", position)
            position = len(source) if newline < 0 else newline + 1
            continue
        if source.startswith("/*", position):
            depth = 1
            position += 2
            while depth and position < len(source):
                if source.startswith("/*", position):
                    depth += 1
                    position += 2
                elif source.startswith("*/", position):
                    depth -= 1
                    position += 2
                else:
                    position += 1
            if depth:
                raise AuditError("unterminated Rust comment")
            continue
        raw = re.match(r'r(#{0,255})"', source[position:])
        if raw:
            end_marker = '"' + raw.group(1)
            end = source.find(end_marker, position + raw.end())
            if end < 0:
                raise AuditError("unterminated Rust raw string")
            end += len(end_marker)
            result.append(source[position:end])
            position = end
            continue
        if source[position] == '"':
            end = position + 1
            while end < len(source):
                if source[end] == "\\":
                    end += 2
                elif source[end] == '"':
                    end += 1
                    break
                else:
                    end += 1
            else:
                raise AuditError("unterminated Rust string")
            result.append(source[position:end])
            position = end
            continue
        word = re.match(r"[A-Za-z_][A-Za-z_0-9]*|[0-9][A-Za-z_0-9]*", source[position:])
        if word:
            result.append(word.group())
            position += word.end()
            continue
        result.append(source[position])
        position += 1
    return result


def matching(items: list[str], start: int, opening: str, closing: str) -> int:
    depth = 0
    for index in range(start, len(items)):
        if items[index] == opening:
            depth += 1
        elif items[index] == closing:
            depth -= 1
            if depth == 0:
                return index
    raise AuditError(f"unmatched {opening}")


def method(source: str, name: str) -> tuple[list[str], list[str], list[str]]:
    items = tokens(source)
    for index in range(len(items) - 2):
        if items[index : index + 2] != ["fn", name]:
            continue
        argument_start = items.index("(", index + 2)
        argument_end = matching(items, argument_start, "(", ")")
        body_start = items.index("{", argument_end + 1)
        body_end = matching(items, body_start, "{", "}")
        arguments = items[argument_start + 1 : argument_end]
        if arguments and arguments[-1] == ",":
            arguments = arguments[:-1]
        return arguments, items[argument_end + 1 : body_start], items[body_start + 1 : body_end]
    raise AuditError(f"missing method {name}")


def equal(label: str, expected: list[str], actual: list[str]) -> None:
    if expected == actual:
        return
    difference = list(difflib.unified_diff(expected, actual, fromfile="expected", tofile="actual"))
    raise AuditError(label + "\n" + "\n".join(difference[:60]))


def remove_once(items: list[str], sequence: list[str], label: str) -> list[str]:
    positions = [index for index in range(len(items)) if items[index : index + len(sequence)] == sequence]
    if len(positions) != 1:
        raise AuditError(f"{label}: expected one allowed addition, found {len(positions)}")
    index = positions[0]
    return items[:index] + items[index + len(sequence) :]


def normalize_delayed(arguments: list[str], returns: list[str], body: list[str], label: str):
    addition = [",", "delay", ":", "Duration"]
    if arguments[-len(addition) :] != addition:
        raise AuditError(f"{label}: delay must be the sole additional last parameter")
    arguments = arguments[: -len(addition)]
    # The old result is retained unchanged, with the measured delay alongside it.
    if returns[:5] != ["-", ">", "Result", "<", "("] or returns[-6:] != [",", "Duration", ")", ",", "MessageError", ">"]:
        raise AuditError(f"{label}: unexpected delayed return type")
    returns = ["-", ">", "Result", "<"] + returns[5:-6] + [",", "MessageError", ">"]
    delay = tokens("let hold_started = Instant::now(); tokio::time::sleep(delay).await; let observed_delay = hold_started.elapsed();")
    commit = tokens("tx.commit().await.map_err(database_error)?;")
    combined = delay + commit
    body_without = remove_once(body, combined, label)
    insertion = next(index for index in range(len(body)) if body[index : index + len(combined)] == combined)
    body = body_without[:insertion] + commit + body_without[insertion:]
    final_ok = max(index for index, token in enumerate(body) if token == "Ok")
    result = body[final_ok:]
    if result[-3:] == [",", ")", ")"]:
        result = result[:-3] + [")", ")"]
    if result[:3] != ["Ok", "(", "("] or result[-4:] != [",", "observed_delay", ")", ")"]:
        raise AuditError(f"{label}: expected only the measured delay alongside the original Ok value")
    body = body[:final_ok] + ["Ok", "("] + result[3:-4] + [")"]
    return arguments, returns, body


def main() -> None:
    original = subprocess.check_output(
        ["git", "-C", str(ROOT), "show", f"{BASE_COMMIT}:{REPO_PATH}"], text=True
    )
    baseline = (ROOT / BASELINE_PATH).read_text()
    current = (ROOT / REPO_PATH).read_text()
    delayed = (ROOT / DELAYED_PATH).read_text()
    for operation in ["create", "edit", "react", "delete"]:
        old_arguments, old_returns, old_body = method(original, operation)
        before_arguments, before_returns, before_body = method(baseline, operation + "_before_sequences")
        before_body = ["require_message_in" if token == "require_message_before_sequences_in" else token for token in before_body]
        if operation == "react":
            before_body = remove_once(before_body, ["seq", ":", "None", ","], "baseline reaction metadata")
        equal(operation + " pinned baseline arguments", old_arguments, before_arguments)
        equal(operation + " pinned baseline return", old_returns, before_returns)
        equal(operation + " pinned baseline body", old_body, before_body)
        for previous, source, name in [
            (True, baseline, operation + "_before_sequences"),
            (False, current, operation),
        ]:
            label = operation + ("_before_commit_delay" if previous else "_after_commit_delay")
            expected = method(source, name)
            normalized = normalize_delayed(*method(delayed, label), label)
            if previous:
                normalized = (*normalized[:2], [
                    "require_message_before_sequences_in" if token == "require_message_delayed_before_in" else token
                    for token in normalized[2]
                ])
            for part, wanted, actual in zip(["arguments", "return", "body"], expected, normalized):
                equal(label + " " + part, wanted, actual)
            print(f"PASS {label}: identical source tokens except measured delay and its return value")
    old_helper = method(original, "require_message_in")
    for source, name in [
        (baseline, "require_message_before_sequences_in"),
        (delayed, "require_message_delayed_before_in"),
    ]:
        actual_helper = method(source, name)
        for part, wanted, actual in zip(["arguments", "return", "body"], old_helper, actual_helper):
            equal(name + " " + part, wanted, actual)
        print(f"PASS {name}: pinned original hydration lookup")
    print(f"PASS pinned baseline bodies match {BASE_COMMIT}; SQL literals are compared byte-for-byte")


if __name__ == "__main__":
    try:
        main()
    except (AuditError, OSError, subprocess.CalledProcessError) as error:
        print(f"FAIL {error}", file=sys.stderr)
        sys.exit(1)
