#!/usr/bin/env python3
"""Scan added lines for customer PII and high-signal secrets.

Default mode reads `git diff --cached` so the pre-commit hook stays on the
staged hunk only. `--changed` covers the same scope as `just check`. `--text`
scans a PR title/body or other free text.

Only humans should add `tooling/pii/exceptions` entries, unless they ask an
agent to.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXCEPTIONS_PATH = Path(__file__).resolve().with_name("exceptions")
MAX_FILE_BYTES = 1_000_000

SAFE_DOMAINS = frozenset(
    {
        "example.com",
        "example.org",
        "example.net",
        "example.edu",
        "macro.com",
        "localhost",
        "invalid",
        "test",
        "local",
        "users.noreply.github.com",
    }
)
SAFE_TLDS = frozenset({"example", "test", "localhost", "invalid", "local"})
SKIP_PATH_PREFIXES = (
    ".sqlx/",
    "packages/sdk/generated/",
)
SKIP_PATH_SUFFIXES = (
    "bun.lock",
    "package-lock.json",
    "Cargo.lock",
    "pnpm-lock.yaml",
    "flake.lock",
)
SKIP_PATHS = frozenset(
    {
        "tooling/pii/exceptions",
        "tooling/pii/test_scan.py",
    }
)

EMAIL_RE = re.compile(
    r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"
)
PHONE_RE = re.compile(
    r"(?<!\w)(?:\+\d{1,3}[\s.-]*)?(?:\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}|\+\d{8,15})(?!\w)"
)
ADDRESS_RE = re.compile(
    r"\b\d{1,5}[A-Za-z]?\s+(?:[A-Z][A-Za-z0-9.'-]+\s+){0,3}"
    r"(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|"
    r"Lane|Ln\.?|Drive|Dr\.?|Court|Ct\.?|Way|Place|Pl\.?)\b"
)
SECRET_PATTERNS = (
    ("secret", re.compile(r"-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----")),
    ("secret", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("secret", re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b")),
    ("secret", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b")),
    ("secret", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b")),
)


@dataclass(frozen=True)
class Finding:
    path: str
    line_no: int
    kind: str
    value: str

    def render(self) -> str:
        location = self.path if self.line_no <= 0 else f"{self.path}:{self.line_no}"
        return f"{location}: {self.kind} [redacted]"


@dataclass
class Exceptions:
    values: set[str]
    path_values: set[str]
    domains: set[str]


def load_exceptions(path: Path = EXCEPTIONS_PATH) -> Exceptions:
    values: set[str] = set()
    path_values: set[str] = set()
    domains: set[str] = set()
    if not path.is_file():
        return Exceptions(values, path_values, domains)
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        lowered = line.lower()
        if lowered.startswith("@") and "/" not in lowered:
            domains.add(lowered[1:])
            continue
        if ":" in line:
            file_path, _, value = line.partition(":")
            if "/" in file_path or file_path.endswith((".rs", ".ts", ".tsx", ".py", ".md")):
                path_values.add(f"{file_path}:{value}".lower())
                continue
        values.add(lowered)
    return Exceptions(values, path_values, domains)


def email_domain(value: str) -> str:
    return value.rsplit("@", 1)[-1].lower().rstrip(".")


def is_safe_email(value: str) -> bool:
    domain = email_domain(value)
    if domain in SAFE_DOMAINS:
        return True
    tld = domain.rsplit(".", 1)[-1]
    return tld in SAFE_TLDS or domain.endswith(".example.com")


def is_excepted(path: str, value: str, exceptions: Exceptions) -> bool:
    lowered = value.lower()
    if lowered in exceptions.values:
        return True
    if f"{path}:{value}".lower() in exceptions.path_values:
        return True
    if "@" in value:
        domain = email_domain(value)
        if domain in exceptions.domains:
            return True
    return False


def skip_path(path: str) -> bool:
    if path in SKIP_PATHS:
        return True
    if path.startswith(SKIP_PATH_PREFIXES) or path.endswith(SKIP_PATH_SUFFIXES):
        return True
    return False


def scan_line(path: str, line_no: int, line: str, exceptions: Exceptions) -> list[Finding]:
    findings: list[Finding] = []

    def add(kind: str, value: str) -> None:
        if not is_excepted(path, value, exceptions):
            findings.append(Finding(path, line_no, kind, value))

    for match in EMAIL_RE.finditer(line):
        value = match.group(0)
        if not is_safe_email(value):
            add("email", value)
    for match in PHONE_RE.finditer(line):
        add("phone", re.sub(r"\s+", " ", match.group(0)).strip())
    for match in ADDRESS_RE.finditer(line):
        add("address", match.group(0))
    for kind, pattern in SECRET_PATTERNS:
        for match in pattern.finditer(line):
            add(kind, match.group(0))
    return findings


def parse_unified_diff(diff: str) -> list[Finding]:
    return list(iter_diff_findings(diff, load_exceptions()))


def iter_diff_findings(diff: str, exceptions: Exceptions) -> Iterable[Finding]:
    path = ""
    new_line_no = 0
    in_hunk = False
    for raw in diff.splitlines():
        if raw.startswith("diff --git "):
            path = ""
            in_hunk = False
            continue
        if not in_hunk and raw.startswith("+++ "):
            plus_path = raw[4:]
            if plus_path == "/dev/null":
                path = ""
                continue
            path = plus_path[2:] if plus_path.startswith("b/") else plus_path
            continue
        if raw.startswith("@@"):
            in_hunk = True
            match = re.search(r"\+(\d+)", raw)
            new_line_no = int(match.group(1)) if match else 0
            continue
        if not path or skip_path(path) or raw.startswith("Binary files "):
            continue
        if in_hunk and raw.startswith("+"):
            yield from scan_line(path, new_line_no, raw[1:], exceptions)
            new_line_no += 1
        elif raw.startswith("-") and not raw.startswith("---"):
            continue
        else:
            new_line_no += 1


def git(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=ROOT,
        check=False,
        text=True,
        capture_output=True,
    )


def staged_diff() -> str:
    result = git("diff", "--cached", "-U0", "--diff-filter=AMR", "--no-color")
    result.check_returncode()
    return result.stdout


def merge_base() -> str:
    result = git("merge-base", "HEAD", "origin/main")
    return result.stdout.strip()


def changed_diff() -> str:
    base = os.environ.get("CHECK_BASE") or merge_base() or "HEAD"
    args = ["diff", "-U0", "--diff-filter=AMR", "--no-color", base]
    result = git(*args)
    result.check_returncode()
    return result.stdout


def untracked_findings(exceptions: Exceptions) -> list[Finding]:
    result = git("ls-files", "--others", "--exclude-standard")
    findings: list[Finding] = []
    for path in result.stdout.splitlines():
        if skip_path(path):
            continue
        file_path = ROOT / path
        if not file_path.is_file():
            continue
        try:
            if file_path.stat().st_size > MAX_FILE_BYTES:
                continue
            text = file_path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        if "\0" in text:
            continue
        for line_no, line in enumerate(text.splitlines(), start=1):
            findings.extend(scan_line(path, line_no, line, exceptions))
    return findings


def scan_text(text: str, exceptions: Exceptions, path: str = "<text>") -> list[Finding]:
    findings: list[Finding] = []
    for line_no, line in enumerate(text.splitlines() or [text], start=1):
        findings.extend(scan_line(path, line_no, line, exceptions))
    return findings


def run_gitleaks() -> int:
    gitleaks = shutil.which("gitleaks")
    if not gitleaks:
        return 0
    result = subprocess.run(
        [gitleaks, "protect", "--staged", "--redact", "--no-banner"],
        cwd=ROOT,
        check=False,
    )
    return result.returncode


def report(findings: list[Finding]) -> int:
    if not findings:
        return 0
    print("PII or secret found in added lines:", file=sys.stderr)
    for finding in findings:
        print(finding.render(), file=sys.stderr)
    print(
        "Redact the value, or ask a human to add an exception in "
        "tooling/pii/exceptions if it is intentional.",
        file=sys.stderr,
    )
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--changed",
        action="store_true",
        help="Scan added lines vs origin/main (and untracked files), like just check.",
    )
    parser.add_argument(
        "--text",
        metavar="TEXT",
        help="Scan a PR title/body or other free text. Use - to read stdin.",
    )
    parser.add_argument(
        "--skip-gitleaks",
        action="store_true",
        help="Skip the optional gitleaks pass.",
    )
    args = parser.parse_args(argv)
    exceptions = load_exceptions()

    if args.text is not None:
        text = sys.stdin.read() if args.text == "-" else args.text
        return report(scan_text(text, exceptions))

    if args.changed:
        findings = list(iter_diff_findings(changed_diff(), exceptions))
        findings.extend(untracked_findings(exceptions))
        return report(findings)

    findings = list(iter_diff_findings(staged_diff(), exceptions))
    status = report(findings)
    if status != 0 or args.skip_gitleaks:
        return status
    return run_gitleaks()


if __name__ == "__main__":
    sys.exit(main())
