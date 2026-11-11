#!/usr/bin/env python3
"""Run service and sender probes in two checkouts on cloned local data."""

import argparse
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import time
import urllib.parse
import uuid


ROOT = pathlib.Path(__file__).resolve().parents[3]
HERE = pathlib.Path(__file__).resolve().parent
SCRATCH_PREFIX = "cgc_fuzz_"


def command(args, *, cwd=None, env=None, capture=False):
    result = subprocess.run(
        ["nix", "develop", "-c", *args],
        cwd=cwd,
        env=env,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
        check=False,
    )
    if result.returncode:
        if capture:
            raise RuntimeError(f"command failed ({result.returncode}): {args[0]}: {result.stderr[:1000]}")
        raise RuntimeError(f"command failed ({result.returncode}): {args[0]}")
    return result.stdout if capture else ""


def local_url(base):
    parsed = urllib.parse.urlsplit(base)
    if parsed.scheme not in ("postgres", "postgresql") or not parsed.hostname:
        raise ValueError("expected a local PostgreSQL URL")
    if parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
        raise ValueError("database URLs must point to localhost")
    return parsed


def database_url(base, name):
    parsed = local_url(base)
    return urllib.parse.urlunsplit(parsed._replace(path="/" + name))


def records(path):
    with path.open() as source:
        return {row["key"]: row["value"] for line in source if (row := json.loads(line))}


def normalize(value):
    if isinstance(value, list):
        return [normalize(item) for item in value]
    if isinstance(value, dict):
        return {
            key: "<timestamp>" if key in {"created_at", "updated_at", "edited_at", "deleted_at", "latest_reply_at"} and item is not None else normalize(item)
            for key, item in value.items()
        }
    return value


def has_names(value):
    if isinstance(value, list):
        return any(has_names(item) for item in value)
    if isinstance(value, dict):
        return {"emoji", "users", "names"}.issubset(value) or any(has_names(item) for item in value.values())
    return False


def changed_paths(old, new, path=""):
    if old == new:
        return []
    if isinstance(old, dict) and isinstance(new, dict):
        paths = []
        for key in sorted(old.keys() | new.keys()):
            child = path + "/" + key.replace("~", "~0").replace("/", "~1")
            if key not in old or key not in new:
                paths.append(child)
            else:
                paths.extend(changed_paths(old[key], new[key], child))
        return paths
    if isinstance(old, list) and isinstance(new, list):
        paths = []
        for index in range(max(len(old), len(new))):
            child = path + "/" + str(index)
            if index >= len(old) or index >= len(new):
                paths.append(child)
            else:
                paths.extend(changed_paths(old[index], new[index], child))
        return paths
    return [path or "/"]


def compare(old_path, new_path, *, normalize_time=False, check_names=False):
    old = records(old_path)
    new = records(new_path)
    differences = []
    for key in sorted(old.keys() | new.keys()):
        a, b = old.get(key), new.get(key)
        if normalize_time:
            a, b = normalize(a), normalize(b)
        if a != b:
            differences.append({
                "key": key,
                "paths": changed_paths(a, b),
                "classification": "regression",
            })
        if check_names and key in new and has_names(new[key]) and not any(difference["key"] == key for difference in differences):
            differences.append({"key": key, "paths": ["/names"], "classification": "regression"})
    if check_names and old_path.read_bytes() != new_path.read_bytes() and not differences:
        differences.append({"key": "serialized_reads", "paths": ["/bytes"], "classification": "regression"})
    return len(old), len(new), differences


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--scratch-url", default="postgres://user:password@localhost:5432/postgres")
    parser.add_argument("--old-checkout", type=pathlib.Path, required=True)
    parser.add_argument("--seed", type=int, default=10268)
    parser.add_argument("--operations", type=int, default=3000)
    parser.add_argument("--keep-output", action="store_true")
    args = parser.parse_args()
    if args.operations < 1:
        parser.error("--operations must be positive")
    old_checkout = args.old_checkout.resolve()
    if not (old_checkout / "crates/messages/Cargo.toml").exists():
        parser.error("--old-checkout must be a Macro checkout")
    if old_checkout == ROOT:
        parser.error("old and new checkouts must differ")
    local_url(args.source_url)

    work = pathlib.Path(tempfile.mkdtemp(prefix="cgc-fuzz-", dir="/tmp"))
    suffix = uuid.uuid4().hex[:12]
    names = [SCRATCH_PREFIX + suffix + "_old", SCRATCH_PREFIX + suffix + "_new", SCRATCH_PREFIX + suffix + "_guest"]
    scratch_admin = database_url(args.scratch_url, "postgres")
    dump = work / "corpus.dump"
    report = {"seed": args.seed, "operations_requested": args.operations, "source": "local database clone"}
    uuid_time_ms = int(time.time() * 1000)
    installed = []
    created = []
    try:
        command(["pg_dump", "--format=custom", "--no-owner", "--no-acl", "--file", str(dump), args.source_url])
        for name in names:
            command(["psql", scratch_admin, "-v", "ON_ERROR_STOP=1", "-c", f'CREATE DATABASE "{name}"'])
            created.append(name)
            command(["pg_restore", "--no-owner", "--no-acl", "--exit-on-error", "--dbname", database_url(args.scratch_url, name), str(dump)])

        for side, checkout, name in zip(("old", "new"), (old_checkout, ROOT), names[:2]):
            for crate, filename in (("messages", "cgc_differential.rs"), ("channel_sender", "cgc_sender.rs")):
                target = checkout / "crates" / crate / "tests" / filename
                target.parent.mkdir(exist_ok=True)
                if target.exists():
                    raise RuntimeError(f"probe path already exists: {target}")
                shutil.copyfile(HERE / filename, target)
                installed.append(target)
            env = os.environ.copy()
            env.update({
                "CGC_DATABASE_URL": database_url(args.scratch_url, name),
                "CGC_OUTPUT_DIR": str(work / side),
                "CGC_SEED": str(args.seed),
                "CGC_OPERATIONS": str(args.operations),
                "CGC_UUID_TIME_MS": str(uuid_time_ms),
                "CARGO_TARGET_DIR": str(pathlib.Path("/tmp") / f"cgc-fuzz-be-target-{side}"),
                "SQLX_OFFLINE": "true",
            })
            (work / side).mkdir()
            command(["cargo", "test", "-p", "channel_sender", "--test", "cgc_sender", "--", "--ignored"], cwd=checkout, env=env)
            command(["cargo", "test", "-p", "messages", "--features", "outbound,activity/outbound", "--test", "cgc_differential", "--", "--ignored"], cwd=checkout, env=env)

        guest_target = ROOT / "crates/messages/tests/cgc_guest.rs"
        if guest_target.exists():
            raise RuntimeError(f"probe path already exists: {guest_target}")
        shutil.copyfile(HERE / "cgc_guest.rs", guest_target)
        installed.append(guest_target)
        guest_output = work / "guest"
        guest_output.mkdir()
        guest_env = os.environ.copy()
        guest_env.update({
            "CGC_DATABASE_URL": database_url(args.scratch_url, names[2]),
            "CGC_OUTPUT_DIR": str(guest_output),
            "CARGO_TARGET_DIR": "/tmp/cgc-fuzz-be-target-new",
            "SQLX_OFFLINE": "true",
        })
        command(["cargo", "test", "-p", "messages", "--features", "outbound", "--test", "cgc_guest", "--", "--ignored"], cwd=ROOT, env=guest_env)

        report["comparisons"] = {}
        for kind in ("senders", "reads", "writes", "rows", "events"):
            old_count, new_count, differences = compare(
                work / "old" / f"{kind}.jsonl",
                work / "new" / f"{kind}.jsonl",
                normalize_time=kind in ("writes", "rows", "events"),
                check_names=kind == "reads",
            )
            report["comparisons"][kind] = {
                "old_cases": old_count,
                "new_cases": new_count,
                "differences": differences,
            }
            if kind == "senders":
                old = records(work / "old" / "senders.jsonl")
                new = records(work / "new" / "senders.jsonl")
                for difference in differences:
                    if (
                        old.get(difference["key"], {}).get("kind") == "error"
                        and new.get(difference["key"], {}).get("kind") == "participant"
                        and new.get(difference["key"], {}).get("canonical_participant")
                    ):
                        difference["classification"] = "intended"
                report["comparisons"][kind]["intended_participant_differences"] = sum(
                    difference["classification"] == "intended" for difference in differences
                )
        report["corpus"] = json.loads((work / "new" / "corpus.json").read_text())
        report["guest"] = json.loads((guest_output / "guest.json").read_text())
        report_path = pathlib.Path("/tmp") / f"cgc-fuzz-report-{suffix}.json"
        report_path.write_text(json.dumps(report, indent=2) + "\n")
        print(f"Report: {report_path}")
        for kind, result in report["comparisons"].items():
            regressions = sum(difference["classification"] == "regression" for difference in result["differences"])
            intended = len(result["differences"]) - regressions
            print(f"{kind}: {result['old_cases']} old / {result['new_cases']} new / {regressions} regressions / {intended} intended differences")
        if any(
            difference["classification"] == "regression"
            for comparison in report["comparisons"].values()
            for difference in comparison["differences"]
        ):
            raise RuntimeError(f"differential regression; see {report_path}")
    finally:
        for path in installed:
            path.unlink(missing_ok=True)
        for name in created:
            command(["psql", scratch_admin, "-v", "ON_ERROR_STOP=1", "-c", f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'])
        if args.keep_output:
            print(f"Private raw output: {work}")
        else:
            shutil.rmtree(work)


if __name__ == "__main__":
    main()
