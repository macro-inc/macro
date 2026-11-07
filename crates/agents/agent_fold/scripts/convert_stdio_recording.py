#!/usr/bin/env python3
"""Turn a stdio ACP recording into the fold's fixture format.

A local recorder wrapping an ACP agent's stdin/stdout writes lines like

    {"ts": "...", "direction": "stdin",  "line": {"jsonrpc": "2.0", ...}}
    {"ts": "...", "direction": "stdout", "line": {"jsonrpc": "2.0", ...}}
    {"ts": "...", "direction": "stderr", "line": "some log text"}

The fold reads `agent_session_log` rows, which the fixtures mirror:

    {"ts": "...", "direction": "to_server",  "content": {"type": "event", "event": "acp_ready"}}
    {"ts": "...", "direction": "to_runtime", "content": {"type": "acp", "jsonrpc": "2.0", ...}}
    {"ts": "...", "direction": "to_server",  "content": {"type": "acp", "jsonrpc": "2.0", ...}}

`stdin` is what the client (us) sent the agent, so it is `to_runtime`;
`stdout` is what the agent sent back, `to_server`. `stderr` is dropped. An
`acp_ready` event is prepended, stamped with the first frame's time, since a
real session's log starts with the runtime announcing itself.

Optional rewrites for fixtures: `--cwd FROM TO` replaces a workspace path
everywhere it appears as a JSON string; `--trim-commands N` keeps only the
first N entries of each `available_commands_update` (those lists run to
hundreds of lines of skill descriptions that prove nothing about the fold).

Run the sanitizer afterwards if the recording came from a real session.

Usage:
    ./convert_stdio_recording.py input.jsonl output.jsonl [--cwd FROM TO] [--trim-commands N]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

DIRECTION = {"stdin": "to_runtime", "stdout": "to_server"}


def rewrite_strings(value, old: str, new: str):
    if isinstance(value, str):
        return value.replace(old, new)
    if isinstance(value, list):
        return [rewrite_strings(item, old, new) for item in value]
    if isinstance(value, dict):
        return {key: rewrite_strings(item, old, new) for key, item in value.items()}
    return value


def trim_commands(frame: dict, keep: int) -> dict:
    update = frame.get("params", {}).get("update")
    if isinstance(update, dict) and update.get("sessionUpdate") == "available_commands_update":
        commands = update.get("availableCommands")
        if isinstance(commands, list):
            update["availableCommands"] = commands[:keep]
    return frame


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--cwd", nargs=2, metavar=("FROM", "TO"))
    parser.add_argument("--trim-commands", type=int, metavar="N")
    args = parser.parse_args()

    out_lines: list[str] = []
    first_ts: str | None = None
    for raw in args.input.read_text().splitlines():
        raw = raw.strip()
        if not raw:
            continue
        entry = json.loads(raw)
        direction = DIRECTION.get(entry.get("direction"))
        if direction is None:
            continue
        frame = entry["line"]
        if not isinstance(frame, dict):
            continue
        if args.cwd:
            frame = rewrite_strings(frame, args.cwd[0], args.cwd[1])
        if args.trim_commands is not None:
            frame = trim_commands(frame, args.trim_commands)
        ts = entry["ts"]
        if first_ts is None:
            first_ts = ts
            out_lines.append(
                json.dumps(
                    {"ts": ts, "direction": "to_server", "content": {"type": "event", "event": "acp_ready"}},
                    separators=(",", ":"),
                )
            )
        content = {"type": "acp", **frame}
        out_lines.append(json.dumps({"ts": ts, "direction": direction, "content": content}, separators=(",", ":")))

    if not out_lines:
        print("no ACP frames found", file=sys.stderr)
        return 1
    args.output.write_text("\n".join(out_lines) + "\n")
    print(f"wrote {len(out_lines)} frames to {args.output}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
