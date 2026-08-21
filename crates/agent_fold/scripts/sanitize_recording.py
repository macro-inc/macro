#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["anthropic>=0.40"]
# ///
"""Strip secrets out of a recorded agent session before it becomes a fixture.

Recordings under ~/.agent_runtime_sessions are real ACP traffic from real
dev sessions: user prompts, terminal output, file contents. Any of those can
carry a real credential the user happened to paste, cat, or have echoed back
by a tool. This finds and replaces them before the file goes anywhere near
`crates/agent_fold/fixtures/` or a git commit.

Two independent passes, because either alone misses things the other catches:

- An LLM pass (Claude Haiku, one tool-forced call per chunk) for secrets that
  only look like secrets in context - a password typed into a prompt, a
  token pasted into a file a tool read back.
- A regex pass for well-known formats (`sk-ant-...`, `ghp_...`, `AKIA...`,
  PEM key blocks, credentialed connection strings, JWTs) that a model can
  occasionally decline to flag or paraphrase instead of quoting verbatim.

Every match, from either pass, is replaced by a placeholder derived from a
hash of the original - not a fake-but-plausible key. A dummy that could pass
for real is worse than one that cannot: nobody would mistake
`DUMMY-SECRET-a3f9e21c-anthropic_key` for a live key, and the same secret
always maps to the same placeholder, so a credential repeated across a
session stays recognizable as "the same thing" without being the thing.

After replacing, the regex pass runs again over the *output*. If anything
still matches, sanitization failed and this refuses to write the file - a
silently-incomplete sanitize is the one failure mode worse than a loud one.

Never prints a secret value, matched or not: only counts and kinds, so a
sanitize report is safe to paste into a chat or a PR description.

Usage:
    ANTHROPIC_API_KEY=... ./sanitize_recording.py input.jsonl output.jsonl
    doppler run --project shared_ai --config dev -- \\
        ./sanitize_recording.py input.jsonl output.jsonl
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from dataclasses import dataclass

from anthropic import Anthropic

MODEL = "claude-haiku-4-5-20251001"

# Lines are grouped into chunks under this size before each goes to the
# model. Grouped by whole lines only - recordings are one JSON object per
# line, so a secret (living inside one line's string values) is never split
# across a chunk boundary this way.
CHUNK_CHARS = 15_000

REPORT_SECRETS_TOOL = {
    "name": "report_secrets",
    "description": (
        "Report every real credential or secret found in the transcript "
        "excerpt, verbatim."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "secrets": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "value": {
                            "type": "string",
                            "description": (
                                "The secret exactly as it appears in the "
                                "text - same characters, same case, no "
                                "surrounding quotes added or removed."
                            ),
                        },
                        "kind": {
                            "type": "string",
                            "description": (
                                "Short label for what it is, e.g. "
                                "'anthropic_key', 'github_token', "
                                "'aws_secret_key', 'db_password', "
                                "'generic_token'."
                            ),
                        },
                    },
                    "required": ["value", "kind"],
                },
            }
        },
        "required": ["secrets"],
    },
}

SYSTEM_PROMPT = """\
You are a secrets scanner reading an excerpt of a recorded coding-agent \
session (user prompts, agent replies, terminal output, file contents).

Report ONLY real, load-bearing credential material: API keys, access \
tokens, passwords, private key blocks, session cookies, connection \
strings with embedded credentials, JWTs, webhook secrets.

Do NOT report:
- Placeholder or example values (`YOUR_API_KEY`, `sk-ant-xxx...`, `<token>`)
- Public identifiers with no secret component (emails, usernames, UUIDs, \
  public URLs, org/repo names, model names, commit hashes)
- Code that merely *mentions* secrets (variable names like `api_key`, a \
  `.env.example` line, a redaction the recording already applied)
- Anything already redacted or truncated with `...` or `[REDACTED]`

When in doubt whether a string is a real secret or a placeholder, skip it -
a missed placeholder costs nothing; a false positive just costs a slightly
less realistic-looking fixture, which is fine.

Report each one exactly as it appears in the text - do not normalize \
whitespace, add quotes, or paraphrase. If you find nothing, report an \
empty list.
"""

# Defense-in-depth for well-known formats. Deliberately conservative on the
# generic patterns (connection strings, JWTs) to avoid false-positive noise
# that would just get skipped anyway; the LLM pass covers the fuzzy cases.
REGEX_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("anthropic_key", re.compile(r"sk-ant-[A-Za-z0-9_-]{20,}")),
    ("openai_key", re.compile(r"sk-[A-Za-z0-9]{20,}")),
    ("github_token", re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}")),
    ("github_fine_grained_pat", re.compile(r"github_pat_[A-Za-z0-9_]{20,}")),
    ("aws_access_key_id", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("google_api_key", re.compile(r"AIza[0-9A-Za-z_-]{35}")),
    ("slack_token", re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}")),
    (
        "private_key_block",
        re.compile(
            r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"
            r".*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----",
            re.DOTALL,
        ),
    ),
    ("jwt", re.compile(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")),
    # Only the credential portion of a connection string, not the whole URL.
    (
        "connection_string_credentials",
        re.compile(r"(?<=://)[^:/\s@]+:[^@/\s]+(?=@)"),
    ),
]


@dataclass(frozen=True)
class Secret:
    value: str
    kind: str
    source: str  # "llm" or "regex:<pattern-name>"


def chunk_lines(text: str, max_chars: int) -> list[str]:
    """Group whole lines into chunks no larger than `max_chars`."""
    chunks: list[str] = []
    current: list[str] = []
    size = 0
    for line in text.splitlines(keepends=True):
        if size + len(line) > max_chars and current:
            chunks.append("".join(current))
            current, size = [], 0
        current.append(line)
        size += len(line)
    if current:
        chunks.append("".join(current))
    return chunks


def find_llm_secrets(client: Anthropic, chunk: str) -> list[Secret]:
    response = client.messages.create(
        model=MODEL,
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        tools=[REPORT_SECRETS_TOOL],
        tool_choice={"type": "tool", "name": "report_secrets"},
        messages=[{"role": "user", "content": chunk}],
    )
    for block in response.content:
        if block.type == "tool_use" and block.name == "report_secrets":
            found = block.input.get("secrets", [])
            return [
                Secret(value=item["value"], kind=item["kind"], source="llm")
                for item in found
                if item.get("value")
            ]
    return []


def find_regex_secrets(text: str) -> list[Secret]:
    found = []
    for kind, pattern in REGEX_PATTERNS:
        for match in pattern.finditer(text):
            found.append(Secret(value=match.group(0), kind=kind, source=f"regex:{kind}"))
    return found


def placeholder_for(secret: Secret) -> str:
    """A stable, obviously-fake replacement.

    Hashed rather than random so the same secret (a token pasted twice in one
    session, or the same env var read on every tool call) always maps to the
    same placeholder - a fixture reader can tell "same secret" from "two
    different secrets" without ever seeing either.
    """
    digest = hashlib.sha256(secret.value.encode("utf-8", errors="surrogatepass")).hexdigest()[:12]
    return f"DUMMY-SECRET-{digest}-{secret.kind}"


def sanitize(text: str, client: Anthropic) -> tuple[str, list[Secret]]:
    all_secrets: dict[str, Secret] = {}

    for chunk in chunk_lines(text, CHUNK_CHARS):
        for secret in find_llm_secrets(client, chunk):
            all_secrets.setdefault(secret.value, secret)

    for secret in find_regex_secrets(text):
        # Regex wins the label on overlap - it is the more specific claim.
        all_secrets[secret.value] = secret

    # Longest first, so a shorter secret that happens to be a substring of a
    # longer one (e.g. an access key id inside a full connection string)
    # never gets replaced first and corrupts the longer match.
    ordered = sorted(all_secrets.values(), key=lambda s: len(s.value), reverse=True)

    sanitized = text
    for secret in ordered:
        sanitized = sanitized.replace(secret.value, placeholder_for(secret))

    return sanitized, ordered


def main() -> None:
    if len(sys.argv) != 3:
        print(f"usage: {sys.argv[0]} <input.jsonl> <output.jsonl>", file=sys.stderr)
        raise SystemExit(2)

    input_path, output_path = sys.argv[1], sys.argv[2]
    text = open(input_path, encoding="utf-8").read()

    client = Anthropic()
    sanitized, found = sanitize(text, client)

    # Self-check: the regex net must find nothing left in the output. If it
    # does, something replaced incompletely (e.g. the LLM paraphrased a
    # value instead of quoting it, so our exact-string replace missed the
    # real occurrence) and writing the file would be a silent leak.
    leftover = find_regex_secrets(sanitized)
    if leftover:
        kinds = ", ".join(sorted({s.kind for s in leftover}))
        print(
            f"REFUSING TO WRITE: {len(leftover)} pattern match(es) survived "
            f"sanitization ({kinds}). Not writing {output_path}.",
            file=sys.stderr,
        )
        raise SystemExit(1)

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(sanitized)

    by_kind: dict[str, int] = {}
    for secret in found:
        by_kind[secret.kind] = by_kind.get(secret.kind, 0) + 1

    print(f"sanitized {input_path} -> {output_path}")
    print(f"  {len(found)} unique secret(s) replaced")
    for kind, count in sorted(by_kind.items()):
        print(f"    {kind}: {count}")
    if not found:
        print("  (nothing found - still worth a manual skim before committing)")


if __name__ == "__main__":
    main()
