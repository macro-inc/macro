"""Compare live, read-only Universal Input predictions against the baseline."""

import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo


def normalize(field, value, suite):
    if field in ("recipients", "cc", "bcc", "guests", "search_from", "assignees", "created_by"):
        people = {
            alias.casefold(): person["email"]
            for person in suite["people"]
            for alias in [person["email"], *person["aliases"]]
        }
        if field == "recipients":
            people.update({channel.casefold(): channel for channel in suite.get("channels", [])})
        return sorted({people.get(term.strip().casefold(), term.strip()) for term in value or []})
    if field == "query":
        return value or ""
    if field == "search_type":
        return next(
            (name for name, aliases in suite["search_types"].items() if (value or "").casefold() in aliases),
            value,
        )
    if field in ("priority", "status"):
        if isinstance(value, list):
            return sorted(item.casefold() for item in value)
        return value.casefold() if isinstance(value, str) else value
    if field == "title" and isinstance(value, str):
        return value.strip().rstrip(".!?").casefold()
    if field in ("start", "due_date") and value:
        try:
            parsed = datetime.datetime.fromisoformat(value)
            if parsed.tzinfo:
                parsed = parsed.astimezone(ZoneInfo(suite["time_zone"]))
            return parsed.date().isoformat() if field == "due_date" else parsed.replace(tzinfo=None).isoformat(timespec="minutes")
        except ValueError:
            return value
    return value.strip() if isinstance(value, str) else value


def compare_fields(expected, intent, suggestions, suite):
    actual = {"intent": intent, **suggestions}
    actual["search_type"] = suggestions.get("type")
    actual["search_from"] = suggestions.get("from")
    priorities = [
        value
        for prop in suggestions.get("properties", [])
        if prop["name"].casefold() == "priority"
        for value in prop["values"]
    ]
    if intent == "task":
        actual["priority"] = priorities[0] if len(priorities) == 1 else priorities or None
    fields = {}
    for field, value in expected.items():
        observed = normalize(field, actual.get(field), suite)
        alternatives = value["any_of"] if isinstance(value, dict) and "any_of" in value else [value]
        wanted = [normalize(field, alternative, suite) for alternative in alternatives]
        fields[field] = {
            "expected": value if isinstance(value, dict) else wanted[0],
            "actual": observed,
            "pass": observed in wanted,
        }
    return fields


def request(base_url, endpoint, body, headers, context=None):
    message = urllib.request.Request(
        base_url.rstrip("/") + "/universal_input/" + endpoint,
        data=json.dumps(body).encode(),
        headers={**headers, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(message, timeout=15, context=context) as response:
        return json.load(response)


def run_case(case_id, text, expected, suite, base_url, headers, context=None):
    result = {"id": case_id, "input": text, "expected": expected}
    started = time.monotonic()
    try:
        classified = request(base_url, "classify", {"text": text, "revision": 1}, headers, context)
        intent = max(classified["scores"], key=lambda item: item["score"])["intent"]
        suggestions = {}
        if intent != "ai":
            extracted = request(base_url, "extract", {
                "text": text, "intent": intent, "revision": 1,
                "reference_time": suite["reference_time"], "time_zone": suite["time_zone"],
                "property_definitions": suite["property_definitions"] if intent in ("task", "search") else [],
            }, headers, context)
            if extracted["intent"] != intent:
                raise ValueError("Extraction returned a different intent")
            suggestions = extracted["suggestions"]
        result.update(scores=classified["scores"], suggestions=suggestions)
        result["fields"] = compare_fields(expected, intent, suggestions, suite)
        result["status"] = "pass" if all(field["pass"] for field in result["fields"].values()) else "fail"
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError) as error:
        result.update(status="error", error=f"{type(error).__name__}: {error}")
    result["seconds"] = round(time.monotonic() - started, 3)
    return result


def compare_reports(previous, current):
    if previous["suite_sha256"] != current["suite_sha256"]:
        raise ValueError("Reports use different baseline fixtures or clocks")
    before = {case["id"]: case for case in previous["cases"]}
    return {
        "regressions": [case["id"] for case in current["cases"] if before.get(case["id"], {}).get("status") == "pass" and case["status"] != "pass"],
        "improvements": [case["id"] for case in current["cases"] if before.get(case["id"], {}).get("status") in ("fail", "error") and case["status"] == "pass"],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True, help="Harness base URL, optionally including /agent-harness")
    parser.add_argument("--suite", type=Path, default=Path(__file__).with_name("baseline.json"))
    parser.add_argument("--report", type=Path, required=True, help="JSON output file for later comparisons")
    parser.add_argument("--compare", type=Path, help="Previous JSON report from the same fixture suite")
    parser.add_argument("--ca-file", type=Path, help="Certificate authority for a local HTTPS proxy")
    args = parser.parse_args()
    token = os.environ.get("UNIVERSAL_INPUT_AUTH_TOKEN")
    key = os.environ.get("INTERNAL_API_KEY")
    user = os.environ.get("UNIVERSAL_INPUT_USER_ID")
    if token:
        headers = {"Authorization": "Bearer " + token}
    elif key and user:
        headers = {"x-internal-auth-key": key, "x-internal-macro-user-id": user}
    else:
        parser.error("Set UNIVERSAL_INPUT_AUTH_TOKEN, or INTERNAL_API_KEY and UNIVERSAL_INPUT_USER_ID")
    raw_suite = args.suite.read_bytes()
    suite = json.loads(raw_suite)
    suite_hash = hashlib.sha256(json.dumps(suite, sort_keys=True).encode()).hexdigest()
    previous = json.loads(args.compare.read_text()) if args.compare else None
    if previous and previous["suite_sha256"] != suite_hash:
        parser.error("Reports use different baseline fixtures or clocks")
    context = ssl.create_default_context(cafile=str(args.ca_file)) if args.ca_file else None
    commit = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=False)
    report = {
        "recorded_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "checkout_commit": commit.stdout.strip(),
        "suite_sha256": suite_hash,
        "reference_time": suite["reference_time"], "time_zone": suite["time_zone"],
        "endpoint": args.url, "cases": [],
    }
    for group in suite["groups"]:
        for index, text in enumerate(group["inputs"], 1):
            result = run_case(f"{group['id']}:{index}", text, group["expect"], suite, args.url, headers, context)
            report["cases"].append(result)
            differences = [name for name, field in result.get("fields", {}).items() if not field["pass"]]
            detail = result.get("error") or ", ".join(differences)
            print(f"{result['status'].upper():5} {result['id']}" + (f": {detail}" if detail else ""), flush=True)
    passed = sum(case["status"] == "pass" for case in report["cases"])
    report["summary"] = {"passed": passed, "total": len(report["cases"])}
    if previous:
        report["comparison"] = compare_reports(previous, report)
        print(json.dumps(report["comparison"], indent=2))
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(f"{passed}/{len(report['cases'])} cases passed; report: {args.report}")
    return 0 if passed == len(report["cases"]) else 1


if __name__ == "__main__":
    sys.exit(main())
