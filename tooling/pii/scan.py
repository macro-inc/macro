#!/usr/bin/env python3
"""Scan added lines for customer PII and high-signal secrets.

Default mode reads staged additions. During a merge, it scans only lines added
relative to every parent, excluding unchanged imported content. `--changed`
covers the same scope as `just check`. `--text` scans a PR title/body or other
free text.

The optional Gitleaks pass conservatively excludes only entire staged files
identical to the same path in an incoming parent; modified files stay scanned.
Sync transcript JWT findings are accepted only after their staged signatures
verify against the public local test key. Generic-key findings qualify only
when their exact flagged secret span lies wholly inside such a verified token;
all unrelated secret findings remain blocked.

Only humans should add `tooling/pii/exceptions` entries, unless they ask an
agent to.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import gzip
import hmac
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
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


def staged_diff(parent: str | None = None) -> str:
    args = ["diff", "--cached", "-U0", "--diff-filter=AMR", "--no-color"]
    if parent is not None:
        args.extend([parent, "--"])
    result = git(*args)
    result.check_returncode()
    return result.stdout


def merge_parents() -> list[str]:
    """Verify incoming merge parents before excluding imported content."""
    result = git("rev-parse", "--git-path", "MERGE_HEAD")
    result.check_returncode()
    merge_head = ROOT / result.stdout.strip()
    if not merge_head.exists():
        return []
    parents = merge_head.read_text(encoding="utf-8").splitlines()
    if not parents:
        raise ValueError("MERGE_HEAD contains no parents")
    verified_parents = []
    for parent in parents:
        verified = git("rev-parse", "--verify", "--end-of-options", f"{parent}^{{commit}}")
        verified.check_returncode()
        verified_parents.append(verified.stdout.strip())
    return verified_parents


def logical_path(path: str) -> str:
    return path.removesuffix(".gz")


def compressed_paths(*args: str) -> list[str]:
    result = git("diff", *args, "--name-only", "--diff-filter=AMR", "-z")
    result.check_returncode()
    return [path for path in result.stdout.split("\0") if path.endswith(".gz") and not skip_path(logical_path(path))]


def file_text(path: str, staged: bool = False) -> str:
    if Path(path).is_absolute() or ".." in Path(path).parts or "\0" in path:
        raise ValueError("Invalid scan path")
    if staged:
        result = subprocess.run(["git", "show", f":0:{path}"], cwd=ROOT, check=True, capture_output=True)
        data = result.stdout
    else:
        data = (ROOT / path).read_bytes()
    if path.endswith(".gz"):
        try:
            data = gzip.decompress(data)
        except (OSError, EOFError) as error:
            raise ValueError(f"Invalid gzip input: {path}") from error
    return data.decode("utf-8")


def body_findings(paths: list[str], exceptions: Exceptions, staged: bool = False) -> list[Finding]:
    findings = []
    for path in paths:
        if not skip_path(logical_path(path)):
            findings.extend(scan_text(file_text(path, staged), exceptions, logical_path(path)))
    return findings


def staged_findings(exceptions: Exceptions) -> list[Finding]:
    """Keep only staged findings on lines newly added relative to every parent."""
    findings = list(iter_diff_findings(staged_diff(), exceptions))
    for parent in merge_parents():
        parent_findings = set(iter_diff_findings(staged_diff(parent), exceptions))
        findings = [finding for finding in findings if finding in parent_findings]
    paths = compressed_paths("--cached")
    parents = merge_parents()
    paths = [path for path in paths if not (parents and unchanged_import(path, parents))]
    findings.extend(body_findings(paths, exceptions, staged=True))
    return findings


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
        if path.endswith(".gz"):
            findings.extend(body_findings([path], exceptions))
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


def unchanged_import(path: str, parents: list[str]) -> bool:
    """Exclude only a same-path staged blob imported unchanged from a parent."""
    if not path or Path(path).is_absolute() or ".." in Path(path).parts or "\0" in path:
        raise ValueError("Invalid Gitleaks finding path")
    staged = git("rev-parse", "--verify", "--end-of-options", f":0:{path}")
    staged.check_returncode()
    for parent in parents:
        entry = git("ls-tree", "-z", parent, "--", f":(literal){path}")
        entry.check_returncode()
        if not entry.stdout:
            continue
        metadata, found_path = entry.stdout.rstrip("\0").split("\t", 1)
        _, kind, oid = metadata.split()
        if found_path == path and kind == "blob" and oid == staged.stdout.strip():
            return True
    return False


def local_transcript_jwt(finding: dict, staged: dict[str, list[str]]) -> bool:
    """Recognize only exact sync fixture tokens signed by the public test key."""
    path = finding["File"]
    if (finding["RuleID"] not in ("jwt", "generic-api-key") or finding.get("Tags")
            or not re.fullmatch(r"crates/sync_server_sim/tests/transcripts(?:-activated)?/[^/]+/[^/]+\.jsonl", path)):
        return False
    line = finding["StartLine"]
    if finding.get("EndLine") != line or line < 1:
        return False
    if path not in staged:
        result = git("show", f":0:{path}")
        result.check_returncode()
        staged[path] = result.stdout.splitlines()
    if line > len(staged[path]):
        return False
    text = staged[path][line - 1]
    tokens = list(re.finditer(
        r"(?<![A-Za-z0-9_-])ey[A-Za-z0-9_-]*\.[A-Za-z0-9_/\\-]*\.[A-Za-z0-9_/\\=-]*",
        text,
    ))
    if not tokens:
        return False
    for token in tokens:
        header, payload, signature = token.group().split(".")
        try:
            decoded_header = json.loads(base64.b64decode(header + "=" * (-len(header) % 4), altchars=b"-_", validate=True))
            decoded_payload = json.loads(base64.b64decode(payload + "=" * (-len(payload) % 4), altchars=b"-_", validate=True))
        except (ValueError, UnicodeDecodeError):
            return False
        if not isinstance(decoded_header, dict) or decoded_header.get("alg") != "HS256" or not isinstance(decoded_payload, dict):
            return False
        digest = hmac.new(b"local", f"{header}.{payload}".encode(), hashlib.sha256).digest()
        expected = base64.urlsafe_b64encode(digest).decode().rstrip("=")
        if not hmac.compare_digest(signature, expected):
            return False
    if finding["RuleID"] == "generic-api-key":
        # The private report identifies the exact original match and secret.
        # Reject ambiguous matches instead of guessing at Gitleaks column offsets.
        match, secret = finding.get("Match"), finding.get("Secret")
        if (not isinstance(match, str) or not isinstance(secret, str)
                or not secret or not match or match.find(secret) < 0
                or match.find(secret) != match.rfind(secret)
                or text.find(match) < 0 or text.find(match) != text.rfind(match)):
            return False
        secret_start = text.index(match) + match.index(secret)
        secret_end = secret_start + len(secret)
        return any(
            token.start() <= secret_start < secret_end <= token.end()
            for token in tokens
        )
    return True


def run_gitleaks() -> int:
    gitleaks = shutil.which("gitleaks")
    if not gitleaks:
        return 0
    command = [gitleaks, "protect", "--staged", "--no-banner"]
    try:
        parents = merge_parents()
        with tempfile.TemporaryDirectory(prefix="macro-pii-") as directory:
            report_path = Path(directory) / "gitleaks.json"
            result = subprocess.run(
                [*command, "--exit-code", "42", "--report-format", "json", "--report-path", str(report_path)],
                cwd=ROOT,
                check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            if result.returncode not in (0, 42):
                return result.returncode
            findings = json.loads(report_path.read_text(encoding="utf-8"))
        if not isinstance(findings, list) or bool(findings) != (result.returncode == 42):
            raise ValueError("Invalid Gitleaks report")
        blocked = 0
        local_tokens = 0
        staged: dict[str, list[str]] = {}
        for finding in findings:
            if (not isinstance(finding, dict)
                    or not isinstance(finding.get("File"), str)
                    or not isinstance(finding.get("RuleID"), str)
                    or type(finding.get("StartLine")) is not int):
                raise ValueError("Invalid Gitleaks finding")
            if local_transcript_jwt(finding, staged):
                local_tokens += 1
                continue
            if parents and unchanged_import(finding["File"], parents):
                continue
            print(f'{finding["File"]}:{finding["StartLine"]}: {finding["RuleID"]} [redacted]', file=sys.stderr)
            blocked += 1
        if local_tokens:
            print(f"Verified {local_tokens} sync transcript JWTs against the public local test key.", file=sys.stderr)
        if not blocked and len(findings) > local_tokens:
            print("Gitleaks findings are in unchanged files imported from a merge parent.", file=sys.stderr)
        return int(blocked != 0)
    except (OSError, ValueError, subprocess.CalledProcessError):
        print("Gitleaks scan failed; commit remains blocked.", file=sys.stderr)
        return 2


def run_file_gitleaks(paths: list[str], staged: bool = False) -> int:
    """Scan decoded bodies; binary Git diffs contain no searchable gzip text."""
    gitleaks = shutil.which("gitleaks")
    if not gitleaks or not paths:
        return 0
    try:
        with tempfile.TemporaryDirectory(prefix="macro-pii-bodies-") as directory:
            source = Path(directory) / "source"
            source.mkdir()
            originals = {}
            bodies = {}
            for path in paths:
                logical = logical_path(path)
                if skip_path(logical):
                    continue
                if logical in originals:
                    raise ValueError("Duplicate logical scan path")
                text = file_text(path, staged)
                destination = source / logical
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_text(text, encoding="utf-8")
                originals[logical] = path
                bodies[logical] = text.splitlines()
            report_path = Path(directory) / "report.json"
            result = subprocess.run(
                [gitleaks, "detect", "--no-git", "--source", str(source), "--no-banner", "--exit-code", "42", "--report-format", "json", "--report-path", str(report_path)],
                cwd=ROOT, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            if result.returncode not in (0, 42):
                return result.returncode
            findings = json.loads(report_path.read_text(encoding="utf-8"))
            if not isinstance(findings, list) or bool(findings) != (result.returncode == 42):
                raise ValueError("Invalid Gitleaks report")
            blocked = 0
            for finding in findings:
                if not isinstance(finding, dict) or not isinstance(finding.get("File"), str) or not isinstance(finding.get("RuleID"), str) or type(finding.get("StartLine")) is not int:
                    raise ValueError("Invalid Gitleaks finding")
                name = Path(finding["File"])
                logical = str(name.relative_to(source)) if name.is_absolute() else str(name)
                if logical not in originals:
                    raise ValueError("Unexpected Gitleaks path")
                finding = {**finding, "File": logical}
                if local_transcript_jwt(finding, bodies):
                    continue
                print(f'{originals[logical]}:{finding["StartLine"]}: {finding["RuleID"]} [redacted]', file=sys.stderr)
                blocked += 1
            return int(blocked != 0)
    except (OSError, ValueError, subprocess.CalledProcessError):
        print("Decoded body secret scan failed; commit remains blocked.", file=sys.stderr)
        return 2


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
    parser.add_argument("--files", nargs="+", help="Scan complete logical file bodies, including gzip, without staging them.")
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

    try:
        if args.files:
            status = report(body_findings(args.files, exceptions))
            return status if status or args.skip_gitleaks else run_file_gitleaks(args.files)
        if args.changed:
            findings = list(iter_diff_findings(changed_diff(), exceptions))
            base = os.environ.get("CHECK_BASE") or merge_base() or "HEAD"
            findings.extend(body_findings(compressed_paths(base), exceptions))
            findings.extend(untracked_findings(exceptions))
            return report(findings)
        findings = staged_findings(exceptions)
        status = report(findings)
        if status != 0 or args.skip_gitleaks:
            return status
        status = run_gitleaks()
        if status:
            return status
        parents = merge_parents()
        paths = [path for path in compressed_paths("--cached") if not (parents and unchanged_import(path, parents))]
        return run_file_gitleaks(paths, staged=True)
    except (OSError, ValueError, subprocess.CalledProcessError):
        print("Logical file scan failed; commit remains blocked.", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
