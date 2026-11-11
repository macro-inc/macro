"""PII scanner coverage for added-line detection and exceptions."""

from __future__ import annotations

import tempfile
import gzip
import subprocess
import unittest
import io
import json
import base64
import hashlib
import hmac
from contextlib import redirect_stderr
from pathlib import Path
from unittest.mock import patch

import scan
from scan import (
    Exceptions,
    iter_diff_findings,
    load_exceptions,
    scan_line,
    scan_text,
)


class ScanLineTest(unittest.TestCase):
    def test_flags_customer_email_and_allows_reserved_domains(self):
        empty = Exceptions(set(), set(), set())
        findings = scan_line(
            "note.md",
            1,
            "Contact ada@customers-inc.com and qa@example.com",
            empty,
        )
        self.assertEqual([finding.value for finding in findings], ["ada@customers-inc.com"])

    def test_allows_macro_and_test_tlds(self):
        empty = Exceptions(set(), set(), set())
        line = "wolf@macro.com qa@billing.test local@foo.localhost"
        self.assertEqual(scan_line("note.md", 1, line, empty), [])

    def test_flags_phone_and_address_not_iso_dates(self):
        empty = Exceptions(set(), set(), set())
        line = "Call +1 415-555-0100 at 100 Market Street on 2026-10-27"
        values = {finding.kind: finding.value for finding in scan_line("note.md", 1, line, empty)}
        self.assertEqual(values["phone"], "+1 415-555-0100")
        self.assertEqual(values["address"], "100 Market Street")
        self.assertNotIn("2026-10-27", values.values())

    def test_flags_private_key_and_github_token(self):
        empty = Exceptions(set(), set(), set())
        key = "-----BEGIN " + "RSA PRIVATE KEY-----"
        token = "ghp" + "_" + ("a" * 36)
        findings = scan_line("leak.txt", 3, f"{key} {token}", empty)
        self.assertEqual({finding.kind for finding in findings}, {"secret"})
        self.assertEqual({finding.value for finding in findings}, {key, token})

    def test_exceptions_cover_value_path_and_domain(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "exceptions"
            path.write_text(
                "\n".join(
                    [
                        "# comment",
                        "+1 415-555-0100",
                        "docs/guide.md:100 Market Street",
                        "@customers-inc.com",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            exceptions = load_exceptions(path)
        self.assertEqual(
            scan_line("any.rs", 1, "pager +1 415-555-0100 and ada@customers-inc.com", exceptions),
            [],
        )
        self.assertEqual(
            scan_line("docs/guide.md", 1, "Office at 100 Market Street", exceptions),
            [],
        )
        leftover = scan_line("other.md", 1, "Office at 100 Market Street", exceptions)
        self.assertEqual(leftover[0].kind, "address")


class DiffAndTextTest(unittest.TestCase):
    def test_only_added_lines_in_a_hunk_are_scanned(self):
        empty = Exceptions(set(), set(), set())
        diff = """diff --git a/note.md b/note.md
--- a/note.md
+++ b/note.md
@@ -1,2 +1,3 @@
-old ada@customers-inc.com
 context
+new ada@customers-inc.com
+qa@example.com
"""
        findings = list(iter_diff_findings(diff, empty))
        self.assertEqual([(finding.line_no, finding.value) for finding in findings], [(2, "ada@customers-inc.com")])

    def test_skips_deleted_files_and_lockfiles(self):
        empty = Exceptions(set(), set(), set())
        diff = """diff --git a/bun.lock b/bun.lock
--- a/bun.lock
+++ b/bun.lock
@@ -1 +1 @@
+secret@customers-inc.com
diff --git a/gone.md b/gone.md
--- a/gone.md
+++ /dev/null
@@ -1 +0,0 @@
-ada@customers-inc.com
"""
        self.assertEqual(list(iter_diff_findings(diff, empty)), [])

    def test_text_mode_flags_pr_body_pii(self):
        empty = Exceptions(set(), set(), set())
        findings = scan_text(
            "Billed max@customers-inc.com immediately",
            empty,
        )
        self.assertEqual(findings[0].kind, "email")
        self.assertEqual(findings[0].path, "<text>")

    def test_added_content_cannot_be_parsed_as_a_file_header(self):
        diff = """diff --git a/note.md b/note.md
--- a/note.md
+++ b/note.md
@@ -0,0 +1,2 @@
+++ ada@customers-inc.com
+more ada@customers-inc.com
"""
        findings = list(iter_diff_findings(diff, Exceptions(set(), set(), set())))
        self.assertEqual([(f.path, f.line_no) for f in findings], [("note.md", 1), ("note.md", 2)])

    def test_reports_do_not_expose_matched_values(self):
        findings = scan_text("ada@customers-inc.com", Exceptions(set(), set(), set()))
        self.assertEqual(findings[0].render(), "<text>:1: email [redacted]")


class GitDiffTest(unittest.TestCase):
    def test_staged_rename_is_scanned_without_a_remote_base(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(scan.os.environ, {"CHECK_BASE": ""}):
            root = Path(tmp)
            subprocess.run(["git", "init", "-q", tmp], check=True)
            original = root / "original.md"
            original.write_text("safe content\n" * 20, encoding="utf-8")
            subprocess.run(["git", "-C", tmp, "add", "."], check=True)
            subprocess.run([
                "git", "-C", tmp, "-c", "user.name=Test", "-c", "user.email=user@example.com",
                "-c", "core.hooksPath=/dev/null", "commit", "-qm", "initial",
            ], check=True)
            renamed = root / "renamed.md"
            original.rename(renamed)
            with renamed.open("a", encoding="utf-8") as file:
                file.write("ada@customers-inc.com\n")
            subprocess.run(["git", "-C", tmp, "add", "-A"], check=True)
            with patch.object(scan, "ROOT", root):
                for diff in (scan.staged_diff(), scan.changed_diff()):
                    findings = list(iter_diff_findings(diff, Exceptions(set(), set(), set())))
                    self.assertEqual([(f.path, f.kind) for f in findings], [("renamed.md", "email")])

    def test_merge_scans_new_resolution_lines_not_unchanged_parent_content(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            subprocess.run(["git", "init", "-q", tmp], check=True)
            subprocess.run(["git", "-C", tmp, "config", "user.name", "Test"], check=True)
            subprocess.run(["git", "-C", tmp, "config", "user.email", "user@example.com"], check=True)
            subprocess.run(["git", "-C", tmp, "config", "core.hooksPath", "/dev/null"], check=True)
            shared = root / "shared.md"
            shared.write_text("base\n", encoding="utf-8")
            subprocess.run(["git", "-C", tmp, "add", "."], check=True)
            subprocess.run(["git", "-C", tmp, "commit", "-qm", "initial"], check=True)
            subprocess.run(["git", "-C", tmp, "branch", "incoming"], check=True)
            shared.write_text("local@customers-inc.com\n", encoding="utf-8")
            subprocess.run(["git", "-C", tmp, "add", "."], check=True)
            subprocess.run(["git", "-C", tmp, "commit", "-qm", "local changes"], check=True)
            local = subprocess.check_output(["git", "-C", tmp, "rev-parse", "HEAD"], text=True).strip()
            subprocess.run(["git", "-C", tmp, "checkout", "-q", "incoming"], check=True)
            shared.write_text("incoming@customers-inc.com\n", encoding="utf-8")
            imported = root / "imported.md"
            imported.write_text("old@customers-inc.com\n", encoding="utf-8")
            subprocess.run(["git", "-C", tmp, "add", "."], check=True)
            subprocess.run(["git", "-C", tmp, "commit", "-qm", "incoming changes"], check=True)
            subprocess.run(["git", "-C", tmp, "checkout", "-q", local], check=True)
            merge = subprocess.run(
                ["git", "-C", tmp, "merge", "--no-commit", "incoming"],
                text=True, capture_output=True,
            )
            self.assertEqual(merge.returncode, 1)
            key = "-----BEGIN " + "RSA PRIVATE KEY-----"
            shared.write_text(
                "local@customers-inc.com\nincoming@customers-inc.com\n"
                f"resolution@customers-inc.com\n{key}\n",
                encoding="utf-8",
            )
            imported.write_text("old@customers-inc.com\nnew@customers-inc.com\n", encoding="utf-8")
            (root / "copy.md").write_text("old@customers-inc.com\n", encoding="utf-8")
            subprocess.run(["git", "-C", tmp, "add", "."], check=True)
            # Unstaged edits do not change the staged merge result.
            imported.write_text("unstaged@customers-inc.com\n", encoding="utf-8")
            with patch.object(scan, "ROOT", root):
                findings = scan.staged_findings(Exceptions(set(), set(), set()))
                self.assertEqual(
                    {(f.path, f.line_no, f.kind) for f in findings},
                    {
                        ("copy.md", 1, "email"),
                        ("imported.md", 2, "email"),
                        ("shared.md", 3, "email"),
                        ("shared.md", 4, "secret"),
                    },
                )
                merge_head = root / ".git" / "MERGE_HEAD"
                merge_head.write_text("imported.md\n", encoding="utf-8")
                with self.assertRaises(subprocess.CalledProcessError):
                    scan.staged_findings(Exceptions(set(), set(), set()))
                merge_head.write_text("not-a-commit\n", encoding="utf-8")
                with self.assertRaises(subprocess.CalledProcessError):
                    scan.staged_findings(Exceptions(set(), set(), set()))
                merge_head.write_text("", encoding="utf-8")
                with self.assertRaises(ValueError):
                    scan.staged_findings(Exceptions(set(), set(), set()))

    def test_git_errors_fail_the_scan(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(scan, "ROOT", Path(tmp)):
            with self.assertRaises(subprocess.CalledProcessError):
                scan.staged_diff()
            with self.assertRaises(subprocess.CalledProcessError):
                scan.changed_diff()


class GitleaksMergeTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.git("init", "-q", "-b", "local")
        self.git("config", "user.name", "Test")
        self.git("config", "user.email", "test@example.com")
        (self.root / "base.txt").write_text("base\n")
        self.git("add", ".")
        self.git("commit", "-qm", "initial")
        self.git("checkout", "-qb", "incoming")
        (self.root / "imported.txt").write_text("existing token fixture\n")
        self.git("add", ".")
        self.git("commit", "-qm", "incoming fixture")
        self.parent = self.git("rev-parse", "HEAD").strip()
        self.git("checkout", "-q", "local")
        (self.root / "local.txt").write_text("local\n")
        self.git("add", ".")
        self.git("commit", "-qm", "local change")
        self.git("merge", "--no-commit", "incoming")
        self.enterContext(patch.object(scan, "ROOT", self.root))

    def git(self, *args):
        return subprocess.check_output(
            ["git", "-C", str(self.root), *args], text=True, stderr=subprocess.DEVNULL,
        )

    def run_tool(self, report, code=42, missing=False, malformed=False):
        original = subprocess.run
        self.output = io.StringIO()

        def run(command, **kwargs):
            if command[0] != "/fake/gitleaks":
                return original(command, **kwargs)
            if "--report-path" in command and not missing:
                path = Path(command[command.index("--report-path") + 1])
                path.write_text("invalid JSON" if malformed else json.dumps(report))
            return subprocess.CompletedProcess(command, code)

        with patch.object(scan.shutil, "which", return_value="/fake/gitleaks"), \
                patch.object(scan.subprocess, "run", side_effect=run), \
                redirect_stderr(self.output):
            return scan.run_gitleaks()

    def finding(self, path):
        return {"File": path, "RuleID": "jwt", "StartLine": 1, "Secret": "do not print this value"}

    def test_unchanged_import_uses_index_and_multiple_verified_parents(self):
        head = self.git("rev-parse", "HEAD").strip()
        (self.root / ".git/MERGE_HEAD").write_text(f"{head}\n{self.parent}\n")
        (self.root / "imported.txt").write_text("unstaged changes\n")
        self.assertEqual(self.run_tool([self.finding("imported.txt")]), 0)
        self.assertIn("unchanged files", self.output.getvalue())
        self.assertNotIn("do not print this value", self.output.getvalue())

    def test_modified_import_new_file_and_copy_stay_blocked(self):
        (self.root / "imported.txt").write_text("existing token fixture\nchanged\n")
        (self.root / "copy.txt").write_text("existing token fixture\n")
        (self.root / "new.txt").write_text("new token fixture\n")
        self.git("add", ".")
        # The working copy cannot disguise changes already staged.
        (self.root / "imported.txt").write_text("existing token fixture\n")
        for path in ("imported.txt", "copy.txt", "new.txt"):
            with self.subTest(path=path):
                self.assertEqual(self.run_tool([self.finding(path)]), 1)
                self.assertIn(f"{path}:1: jwt [redacted]", self.output.getvalue())
                self.assertNotIn("do not print this value", self.output.getvalue())

    def test_non_merge_retains_tool_result(self):
        (self.root / ".git/MERGE_HEAD").unlink()
        self.assertEqual(self.run_tool([], code=7), 7)

    def test_transcript_jwts_require_staged_local_signatures(self):
        path = "crates/sync_server_sim/tests/transcripts/example.test/scenario.jsonl"
        file = self.root / path
        file.parent.mkdir(parents=True)

        def token(key=b"local", algorithm="HS256", payload=b'{"user_id":"test-user"}'):
            encode = lambda value: base64.urlsafe_b64encode(value).decode().rstrip("=")
            header = encode(json.dumps({"alg": algorithm}).encode())
            body = f"{header}.{encode(payload)}"
            return body + "." + encode(hmac.new(key, body.encode(), hashlib.sha256).digest())

        valid = token()
        finding = {**self.finding(path), "EndLine": 1, "Tags": []}
        for value, allowed in (
            (valid, True), (token(b"another-key"), False),
            (token(algorithm="none"), False), (token(payload=b"not-json"), False),
            (valid + " " + token(b"another-key"), False), ("eyJbroken.broken.broken", False),
            (valid + " " + token(b"another-key", payload='{"value":"\uffff"}'.encode()).replace("_", "/"), False),
        ):
            with self.subTest(allowed=allowed, length=len(value)):
                file.write_text(json.dumps({"token": value}) + "\n")
                self.git("add", path)
                file.write_text(json.dumps({"token": valid}) + "\n")
                self.assertEqual(self.run_tool([finding]), 0 if allowed else 1)

        activated_path = "crates/sync_server_sim/tests/transcripts-activated/example.test/scenario.jsonl"
        activated = self.root / activated_path
        activated.parent.mkdir(parents=True)
        for value, allowed in ((valid, True), (token(b"another-key"), False)):
            activated.write_text(json.dumps({"token": value}) + "\n")
            self.git("add", activated_path)
            self.assertEqual(self.run_tool([{**finding, "File": activated_path}]), 0 if allowed else 1)

        file.write_text(json.dumps({"token": valid}) + "\n")
        self.git("add", path)
        for field in ({"RuleID": "generic-api-key"}, {"Tags": ["decoded:base64"]}, {"EndLine": 2}):
            self.assertEqual(self.run_tool([{**finding, **field}]), 1)
        outside = self.root / "ordinary.jsonl"
        outside.write_text(file.read_text())
        self.git("add", "ordinary.jsonl")
        self.assertEqual(self.run_tool([{**finding, "File": "ordinary.jsonl"}]), 1)
        for outside_path in (
            "services/sync-service/tests/transcripts/example.test/scenario.jsonl",
            "crates/sync_server_sim/tests/transcripts/scenario.jsonl",
            "crates/sync_server_sim/tests/transcripts/example.test/nested/scenario.jsonl",
            "crates/sync_server_sim/tests/transcripts-copy/example.test/scenario.jsonl",
        ):
            outside = self.root / outside_path
            outside.parent.mkdir(parents=True, exist_ok=True)
            outside.write_text(file.read_text())
            self.git("add", outside_path)
            self.assertEqual(self.run_tool([{**finding, "File": outside_path}]), 1)
        (self.root / ".git/MERGE_HEAD").unlink()
        self.assertEqual(self.run_tool([finding]), 0)

    def test_generic_findings_require_exact_span_in_verified_local_token(self):
        path = "crates/sync_server_sim/tests/transcripts-activated/example.test/scenario.jsonl"
        file = self.root / path
        file.parent.mkdir(parents=True)
        encode = lambda value: base64.urlsafe_b64encode(value).decode().rstrip("=")
        body = encode(b'{"alg":"HS256"}') + "." + encode(b'{"user_id":"test-user"}')
        valid = body + "." + encode(hmac.new(b"local", body.encode(), hashlib.sha256).digest())
        wrong = body + "." + encode(hmac.new(b"other", body.encode(), hashlib.sha256).digest())

        def check(text, start, end, allowed):
            file.write_text(text + "\n")
            self.git("add", path)
            finding = {
                "File": path, "RuleID": "generic-api-key", "Tags": [],
                "StartLine": 1, "EndLine": 1,
                "StartColumn": len(text[:start].encode()) + 1,
                "EndColumn": len(text[:end].encode()),
                "Match": text[start:end], "Secret": text[start:end],
            }
            self.assertEqual(self.run_tool([finding]), 0 if allowed else 1)

        # Non-ASCII context does not change exact original match/secret locations.
        text = "\u03bb token=" + valid + " unrelated=independent-secret"
        start = text.index(valid)
        check(text, start + 5, start + 20, True)
        # Exact Match may include context outside the token; only Secret is exempt.
        finding = {
            "File": path, "RuleID": "generic-api-key", "Tags": [],
            "StartLine": 1, "EndLine": 1,
            "Match": text[start - 6:start + 23],
            "Secret": text[start:start + 20],
        }
        self.assertEqual(self.run_tool([finding]), 0)
        for field in ({"Match": "missing context"}, {"Secret": "unrelated"},
                      {"Match": ""}, {"Secret": ""}):
            self.assertEqual(self.run_tool([{**finding, **field}]), 1)
        file.write_text(text + " " + text + "\n")
        self.git("add", path)
        self.assertEqual(self.run_tool([finding]), 1)
        unrelated = text.index("independent-secret")
        check(text, unrelated, len(text), False)
        check("token=" + wrong, 5, 20, False)
        check(text, start - 1, start + 20, False)
        truncated = "token=" + valid[:-1]
        check(truncated, 5, 20, False)

        # Leading JSON whitespace creates overlapping base64 occurrences in a
        # valid signed token, not merely an unrelated malformed input.
        repeated_body = encode(b'{"alg":"HS256"}') + "." + encode(b" " * 12 + b'{}')
        repeated = repeated_body + "." + encode(hmac.new(b"local", repeated_body.encode(), hashlib.sha256).digest())
        file.write_text("token=" + repeated + "\n")
        self.git("add", path)
        repeated_part = encode(b" " * 12)
        for match, secret in ((repeated_part, repeated_part[:9]),
                              (repeated_part[:9], repeated_part[:9])):
            self.assertEqual(self.run_tool([{
                **finding, "Match": match, "Secret": secret,
            }]), 1)

    def test_invalid_parent_and_empty_merge_state_fail_closed(self):
        for value in ("not-a-commit\n", "imported.txt\n", ""):
            with self.subTest(value=value):
                (self.root / ".git/MERGE_HEAD").write_text(value)
                self.assertEqual(self.run_tool([self.finding("imported.txt")]), 2)

    def test_tool_and_report_errors_fail_closed(self):
        for kwargs in (
            {"code": 2}, {"missing": True}, {"malformed": True}, {"code": 0},
        ):
            with self.subTest(kwargs=kwargs):
                self.assertNotEqual(self.run_tool([self.finding("imported.txt")], **kwargs), 0)
        for report in ({}, [None], [{"File": "imported.txt"}], []):
            with self.subTest(report=report):
                self.assertEqual(self.run_tool(report), 2)
        self.assertEqual(self.run_tool([], code=0), 0)

    def test_invalid_finding_path_and_missing_index_blob_fail_closed(self):
        for path in ("", "../imported.txt", "/imported.txt", "missing.txt"):
            with self.subTest(path=path):
                self.assertEqual(self.run_tool([self.finding(path)]), 2)

    def test_git_failure_fails_closed(self):
        with patch.object(scan, "git", side_effect=subprocess.CalledProcessError(1, ["git"])):
            self.assertEqual(self.run_tool([self.finding("imported.txt")]), 2)


class CompressedBodyTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.git("init", "-q", "-b", "local")
        self.git("config", "user.name", "Test")
        self.git("config", "user.email", "test@example.com")
        (self.root / "base.txt").write_text("base\n")
        self.git("add", ".")
        self.git("commit", "-qm", "initial")
        self.enterContext(patch.object(scan, "ROOT", self.root))
        self.exceptions = Exceptions(set(), set(), set())

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.root), *args], text=True, stderr=subprocess.DEVNULL)

    def test_staged_gzip_secret_is_scanned_as_logical_text(self):
        token = "ghp" + "_" + "a" * 36
        (self.root / "fixture.jsonl.gz").write_bytes(gzip.compress((token + "\n").encode()))
        self.git("add", "fixture.jsonl.gz")
        findings = scan.staged_findings(self.exceptions)
        self.assertTrue(any(f.kind == "secret" and f.value == token for f in findings))

    def test_concatenated_gzip_members_include_late_secret(self):
        token = "ghp" + "_" + "a" * 36
        body = gzip.compress(b"clean\n") + gzip.compress((token + "\n").encode())
        (self.root / "fixture.jsonl.gz").write_bytes(body)
        self.git("add", "fixture.jsonl.gz")
        findings = scan.staged_findings(self.exceptions)
        self.assertTrue(any(f.kind == "secret" and f.line_no == 2 for f in findings))

    def test_corrupt_trailing_member_and_crc_fail_closed(self):
        valid = gzip.compress(b"clean\n")
        corrupt = bytearray(valid)
        corrupt[-5] ^= 1
        for data in [valid + b"junk", valid + valid[:9], bytes(corrupt)]:
            with self.subTest(data_length=len(data)):
                (self.root / "fixture.jsonl.gz").write_bytes(data)
                self.git("add", "fixture.jsonl.gz")
                with self.assertRaises(ValueError):
                    scan.staged_findings(self.exceptions)
                with redirect_stderr(io.StringIO()):
                    self.assertEqual(scan.main(["--skip-gitleaks"]), 2)

    def test_staged_gzip_scans_index_not_unstaged_worktree(self):
        token = "ghp" + "_" + "a" * 36
        path = self.root / "fixture.jsonl.gz"
        path.write_bytes(gzip.compress((token + "\n").encode()))
        self.git("add", "fixture.jsonl.gz")
        path.write_bytes(gzip.compress(b"clean\n"))
        self.assertTrue(scan.staged_findings(self.exceptions))
        self.git("add", "fixture.jsonl.gz")
        path.write_bytes(gzip.compress((token + "\n").encode()))
        self.assertEqual(scan.staged_findings(self.exceptions), [])

    def test_untracked_gzip_scans_past_plain_text_size_limit(self):
        token = "ghp" + "_" + "a" * 36
        data = b"clean\n" * (scan.MAX_FILE_BYTES // 6 + 1) + (token + "\n").encode()
        (self.root / "fixture.jsonl.gz").write_bytes(gzip.compress(data))
        self.assertTrue(any(f.kind == "secret" for f in scan.untracked_findings(self.exceptions)))

    def test_changed_mode_scans_compressed_worktree(self):
        token = "ghp" + "_" + "a" * 36
        (self.root / "fixture.jsonl.gz").write_bytes(gzip.compress((token + "\n").encode()))
        self.git("add", "fixture.jsonl.gz")
        with patch.dict(scan.os.environ, {"CHECK_BASE": "HEAD"}), redirect_stderr(io.StringIO()):
            self.assertEqual(scan.main(["--changed", "--skip-gitleaks"]), 1)

    def test_explicit_gzip_file_mode_needs_no_staging(self):
        token = "ghp" + "_" + "a" * 36
        (self.root / "fixture.jsonl.gz").write_bytes(gzip.compress((token + "\n").encode()))
        with redirect_stderr(io.StringIO()):
            self.assertEqual(scan.main(["--files", "fixture.jsonl.gz", "--skip-gitleaks"]), 1)

    def test_decoded_gitleaks_checks_real_body_and_redacts_secret(self):
        binary = scan.shutil.which("gitleaks")
        if not binary:
            self.skipTest("actual gitleaks binary unavailable")
        token = "ghp" + "_" + "u8Jk4P0sX7vQ2aN9cF6mL1dR5wT3yH0bV8zS"
        (self.root / "fixture.jsonl.gz").write_bytes(gzip.compress((token + "\n").encode()))
        output = io.StringIO()
        with patch.object(scan.shutil, "which", return_value=str(binary)), redirect_stderr(output):
            self.assertEqual(scan.run_file_gitleaks(["fixture.jsonl.gz"]), 1)
        self.assertNotIn(token, output.getvalue())
        self.assertIn("[redacted]", output.getvalue())


if __name__ == "__main__":
    unittest.main()
