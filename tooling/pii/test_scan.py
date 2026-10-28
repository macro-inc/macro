"""PII scanner coverage for added-line detection and exceptions."""

from __future__ import annotations

import tempfile
import subprocess
import unittest
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

    def test_git_errors_fail_the_scan(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(scan, "ROOT", Path(tmp)):
            with self.assertRaises(subprocess.CalledProcessError):
                scan.staged_diff()
            with self.assertRaises(subprocess.CalledProcessError):
                scan.changed_diff()


if __name__ == "__main__":
    unittest.main()
