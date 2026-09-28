"""Portable unit/configuration checks; no simulator or third-party packages needed."""

from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import plistlib
import re
import tomllib
import unittest
from unittest.mock import patch

from smoke import (
    COLD_SOURCE, WARM_SOURCE, ProcessIdentity, check_counts, check_process,
    event_counts, log_predicate,
)

PROCESS = ProcessIdentity(42, datetime(2026, 9, 18, 16, 0, 0, 123456, tzinfo=timezone.utc))

WEB = Path(__file__).resolve().parents[3]
TAURI = WEB / "tauri"
APP = TAURI / "src-tauri"


class EventTests(unittest.TestCase):
    def event(self, source, pid=42, timestamp=None):
        return {
            "processID": pid,
            "timestamp": (timestamp or PROCESS.started_at).isoformat(),
            "eventMessage": f"emitting Opened with 1 URL(s) from {source}",
        }

    def test_normal_launch_and_unrelated_process(self):
        counts = event_counts([self.event(COLD_SOURCE, pid=99)], PROCESS)
        check_counts(counts, 0, 0, 0)

    def test_one_cold_and_one_warm_link(self):
        counts = event_counts([self.event(COLD_SOURCE), self.event(WARM_SOURCE)], PROCESS)
        check_counts(counts, 1, 1)

    def test_duplicate_cold_event_fails(self):
        counts = event_counts([self.event(COLD_SOURCE)] * 2, PROCESS)
        with self.assertRaises(AssertionError):
            check_counts(counts, 1, 0)

    def test_missing_cold_event_fails(self):
        with self.assertRaises(AssertionError):
            check_counts(event_counts([], PROCESS), 1, 0)

    def test_multiple_urls_in_one_event_fails(self):
        event = self.event(COLD_SOURCE)
        event["eventMessage"] = event["eventMessage"].replace("1 URL(s)", "2 URL(s)")
        with self.assertRaises(AssertionError):
            event_counts([event], PROCESS)

    def test_resume_must_increment_without_replaying_link(self):
        resume = {"processID": 42, "timestamp": PROCESS.started_at.isoformat(),
                  "eventMessage": "mobile window resumed, window_label: main"}
        before = event_counts([self.event(COLD_SOURCE), resume], PROCESS)
        after = event_counts([self.event(COLD_SOURCE), resume, resume], PROCESS)
        check_counts(after, 1, 0, before["resumed"] + 1)
        with self.assertRaises(AssertionError):
            check_counts(before, 1, 0, before["resumed"] + 1)

    def test_reused_pid_logs_cannot_satisfy_cold_checkpoint(self):
        old = self.event(COLD_SOURCE, timestamp=PROCESS.started_at - timedelta(microseconds=1))
        counts = event_counts([old], PROCESS)
        check_counts(counts, 0, 0)
        with self.assertRaises(AssertionError):
            check_counts(counts, 1, 0)
        check_counts(event_counts([old, self.event(COLD_SOURCE)], PROCESS), 1, 0)

    def test_log_timestamps_are_compared_with_timezone(self):
        event = self.event(COLD_SOURCE)
        event["timestamp"] = "2026-09-18 12:00:00.123456-0400"
        check_counts(event_counts([event], PROCESS), 1, 0)
        event["timestamp"] = "2026-09-18 12:00:00.123456"
        with self.assertRaises(ValueError):
            event_counts([event], PROCESS)


class ProcessTests(unittest.TestCase):
    def test_same_incarnation_is_alive(self):
        with patch("smoke.process_identity", return_value=PROCESS) as read:
            check_process(PROCESS)
        read.assert_called_once_with(PROCESS.pid)

    def test_reused_pid_is_not_alive_even_within_same_second(self):
        replacement = ProcessIdentity(PROCESS.pid, PROCESS.started_at + timedelta(microseconds=1))
        with patch("smoke.process_identity", return_value=replacement):
            with self.assertRaises(AssertionError):
                check_process(PROCESS)

    def test_disappeared_process_fails(self):
        with patch("smoke.process_identity", side_effect=ProcessLookupError):
            with self.assertRaises(ProcessLookupError):
                check_process(PROCESS)

    def test_predicate_uses_process_start_and_nsdate_epoch(self):
        process = ProcessIdentity(42, datetime(2001, 1, 1, 0, 0, 1, 234567, tzinfo=timezone.utc))
        predicate = log_predicate(process)
        self.assertIn("processIdentifier == 42", predicate)
        self.assertIn('date >= CAST(1.234567, "NSDate")', predicate)


class ConfigurationTests(unittest.TestCase):
    def test_scene_manifests_match_and_disable_additional_windows(self):
        expected = {
            "UIApplicationSupportsMultipleScenes": False,
            "UISceneConfigurations": {
                "UIWindowSceneSessionRoleApplication": [{"UISceneConfigurationName": "TaoScene"}]
            },
        }
        for relative in ("Info.ios.plist", "gen/apple/app_iOS/Info.plist"):
            with self.subTest(path=relative):
                with (APP / relative).open("rb") as file:
                    self.assertEqual(plistlib.load(file)["UIApplicationSceneManifest"], expected)
        # Keep the checked-in XcodeGen declaration aligned without requiring a
        # YAML dependency for these stdlib-only tests.
        self.assertIn(
            "        UIApplicationSceneManifest:\n"
            "          UIApplicationSupportsMultipleScenes: false\n"
            "          UISceneConfigurations:\n"
            "            UIWindowSceneSessionRoleApplication:\n"
            "              - UISceneConfigurationName: TaoScene\n",
            (APP / "gen/apple/project.yml").read_text(),
        )

    def test_ios_minimum_is_consistent(self):
        config = json.loads((APP / "tauri.conf.json").read_text())
        self.assertEqual(config["bundle"]["iOS"]["minimumSystemVersion"], "15.0")
        self.assertRegex((APP / "gen/apple/project.yml").read_text(), r"(?m)^    iOS: 15\.0$")
        project = (APP / "gen/apple/app.xcodeproj/project.pbxproj").read_text()
        targets = re.findall(r"IPHONEOS_DEPLOYMENT_TARGET = ([^;]+);", project)
        self.assertGreaterEqual(len(targets), 2, "Both debug and release must declare the minimum")
        self.assertEqual(set(targets), {"15.0"})

    def test_fork_sources_use_macro_inc_and_consistent_tauri_revision(self):
        manifest = tomllib.loads((TAURI / "Cargo.toml").read_text())
        tauri = manifest["workspace"]["dependencies"]["tauri"]
        self.assertEqual(tauri["git"], "https://github.com/macro-inc/tauri")
        patches = manifest["patch"]["crates-io"]
        for name in ("tauri", "tauri-runtime", "tauri-runtime-wry", "tauri-utils",
                     "tauri-macros", "tauri-codegen", "tauri-build"):
            with self.subTest(crate=name):
                self.assertEqual(patches[name], tauri)
        self.assertEqual(patches["tao"]["git"], "https://github.com/macro-inc/tao")
        self.assertRegex(patches["tao"]["rev"], r"^[0-9a-f]{40}$")


if __name__ == "__main__":
    unittest.main()
