#!/usr/bin/env python3
"""Read-only lifecycle/link smoke test for an installed Macro debug simulator app."""

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
import plistlib
import re
import subprocess
import sys
import tempfile
import time
import uuid

APP = "com.macro.app.prod"
COLD_SOURCE = "scene:willConnectToSession:options:"
WARM_SOURCE = "scene:openURLContexts:"


@dataclass(frozen=True)
class ProcessIdentity:
    pid: int
    started_at: datetime


def process_identity(pid):
    # Use isolated Xcode Python for Darwin's libproc: Nix's ctypes/libffi can
    # abort on macOS 27, and PYTHONPATH must not mix the two installations.
    # The main runner and portable tests do not import platform-specific ctypes.
    result = subprocess.run(
        ["/usr/bin/python3", "-I", str(Path(__file__).with_name("process_identity.py")), str(pid)],
        capture_output=True, text=True, check=True, timeout=10,
    )
    return ProcessIdentity(pid, datetime.fromisoformat(result.stdout.strip()))


def check_process(process):
    if process_identity(process.pid) != process:
        raise AssertionError(f"Macro PID {process.pid} was reused by another process incarnation")


def log_predicate(process):
    # NSPredicate's NSDate numeric epoch is 2001-01-01, not Unix's 1970 epoch.
    since = (process.started_at - datetime(2001, 1, 1, tzinfo=timezone.utc)).total_seconds()
    return (
        f'processIdentifier == {process.pid} AND date >= CAST({since:.6f}, "NSDate") AND '
        '(eventMessage CONTAINS "emitting Opened" OR '
        'eventMessage CONTAINS "mobile window resumed")'
    )


def event_counts(events, process):
    """Count only events belonging to this PID's current incarnation."""
    counts = {"cold": 0, "warm": 0, "resumed": 0}
    for event in events:
        if event.get("processID") != process.pid:
            continue
        timestamp = datetime.fromisoformat(event["timestamp"])
        if timestamp.tzinfo is None:
            raise ValueError("Log timestamps must include their timezone")
        if timestamp < process.started_at:
            continue
        message = event.get("eventMessage", "")
        if "emitting Opened" in message:
            if "emitting Opened with 1 URL(s)" not in message:
                raise AssertionError("Expected exactly one URL in each Opened event")
            if COLD_SOURCE in message:
                counts["cold"] += 1
            elif WARM_SOURCE in message:
                counts["warm"] += 1
            else:
                raise AssertionError("Unexpected Opened delivery path")
        if "mobile window resumed" in message:
            counts["resumed"] += 1
    return counts


def check_counts(counts, cold, warm, resumed=None):
    expected = {"cold": cold, "warm": warm}
    if resumed is not None:
        expected["resumed"] = resumed
    for key, value in expected.items():
        if counts[key] != value:
            raise AssertionError(f"{key}: expected {value}, got {counts[key]}")


def xcrun(*args, check=True):
    return subprocess.run(
        ["/usr/bin/xcrun", *args], capture_output=True, text=True,
        check=check, timeout=60,
    )


class Smoke:
    def __init__(self, device, output, settle):
        self.device = device
        self.output = output
        self.settle = settle
        self.results = []

    def launch(self):
        result = xcrun("simctl", "launch", self.device, APP)
        match = re.search(rf"{re.escape(APP)}: (\d+)", result.stdout)
        if not match:
            raise RuntimeError("simctl launch did not return Macro's PID")
        return process_identity(int(match.group(1)))

    def stop(self):
        result = xcrun("simctl", "terminate", self.device, APP, check=False)
        if result.returncode and not any(
            text in result.stderr.lower()
            for text in ("found nothing to terminate", "not running")
        ):
            raise RuntimeError(result.stderr)

    def link(self, url):
        xcrun("devicectl", "device", "process", "launch", "--device",
              self.device, "--payload-url", url, APP)
        return self.launch()

    def checkpoint(self, name, process, cold, warm, resumed=None):
        time.sleep(self.settle)
        # Simulator processes share the host PID namespace. Check the birth
        # timestamp, not just liveness; never relaunch a crashed app to check it.
        check_process(process)
        predicate = log_predicate(process)
        raw = xcrun("simctl", "spawn", self.device, "log", "show", "--last",
                    "30m", "--debug", "--style", "json", "--predicate", predicate).stdout
        (self.output / f"{name}.json").write_text(raw)
        xcrun("simctl", "io", self.device, "screenshot",
              str(self.output / f"{name}.png"))
        check_process(process)
        counts = event_counts(json.loads(raw), process)
        result = {
            "test": name, "pid": process.pid,
            "started_at": process.started_at.isoformat(), **counts, "passed": False,
        }
        self.results.append(result)
        check_counts(counts, cold, warm, resumed)
        result["passed"] = True
        print(json.dumps(result), flush=True)
        return counts

    def run(self):
        self.stop()
        self.checkpoint("normal", self.launch(), 0, 0)

        self.stop()
        process = self.link("macro://app/login")
        self.checkpoint("cold-login", process, 1, 0)
        if self.link("macro://app/welcome") != process:
            raise AssertionError("Warm link unexpectedly restarted Macro")
        before = self.checkpoint("warm-welcome", process, 1, 1)

        xcrun("simctl", "launch", self.device, "com.apple.mobilesafari")
        time.sleep(3)
        if self.launch() != process:
            raise AssertionError("Foregrounding unexpectedly restarted Macro")
        self.checkpoint("resumed", process, 1, 1, before["resumed"] + 1)

        self.stop()
        self.checkpoint("normal-after-links", self.launch(), 0, 0)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", required=True, type=uuid.UUID, help="Booted simulator UDID")
    parser.add_argument("--allow-restart", action="store_true", help="Allow terminating Macro; save drafts first")
    parser.add_argument("--settle-seconds", type=float, default=10, help="Wait before each checkpoint (default: 10)")
    args = parser.parse_args()
    if sys.platform != "darwin":
        parser.error("This smoke test requires macOS and Xcode 27")
    if not args.allow_restart:
        parser.error("Save any drafts, then pass --allow-restart; this test terminates Macro")
    if not 1 <= args.settle_seconds <= 60:
        parser.error("--settle-seconds must be between 1 and 60")
    device = str(args.device).upper()
    devices = json.loads(xcrun("simctl", "list", "devices", "booted", "--json").stdout)
    if not any(d["udid"] == device for group in devices["devices"].values() for d in group):
        parser.error("The requested simulator must already be booted")
    container = xcrun("simctl", "get_app_container", device, APP, "app").stdout.strip()
    with (Path(container) / "Info.plist").open("rb") as file:
        info = plistlib.load(file)
    manifest = info.get("UIApplicationSceneManifest", {})
    if manifest.get("UIApplicationSupportsMultipleScenes") is not False:
        parser.error("Installed Macro must use the single-window scene manifest")

    # mkdtemp uses mode 0700: screenshots may contain real account data.
    output = Path(tempfile.mkdtemp(prefix="macro-ios-smoke-"))
    print(f"Evidence: {output}", flush=True)
    smoke = Smoke(device, output, args.settle_seconds)
    try:
        smoke.run()
    finally:
        (output / "results.json").write_text(json.dumps(smoke.results, indent=2))
    print("PASS: lifecycle/link events. Review screenshots separately for navigation/rendering.")


if __name__ == "__main__":
    main()
