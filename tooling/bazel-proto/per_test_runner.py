#!/usr/bin/env python3
"""Runs each test of a libtest binary in its own process, as nextest does.

Used as `bazel test --run_under`. Prints libtest's result line so the totals add up the
same way, and exits non-zero if any test failed.
"""
import concurrent.futures
import os
import subprocess
import sys
import time


def listing(binary, *extra):
    done = subprocess.run([binary, "--list", "--format=terse", *extra], capture_output=True, text=True)
    if done.returncode != 0:
        return None
    return [line[: -len(": test")] for line in done.stdout.splitlines() if line.endswith(": test")]


def run(binary, name, limit):
    started = time.monotonic()
    try:
        done = subprocess.run(
            [binary, "--exact", name, "--test-threads=1"],
            capture_output=True,
            text=True,
            errors="replace",
            timeout=limit,
        )
        return name, done.returncode == 0, done.stdout + done.stderr, time.monotonic() - started
    except subprocess.TimeoutExpired as expired:
        output = (expired.stdout or b"").decode(errors="replace")
        return name, False, f"timed out after {limit}s\n{output}", limit


def main():
    binary, *args = sys.argv[1:]
    binary = os.path.abspath(binary)
    # cargo and nextest run tests from the package directory.
    os.chdir(os.environ["CARGO_MANIFEST_DIR"])
    every = listing(binary)
    if every is None:
        # A custom harness has no --list; let it run itself.
        os.execv(binary, [binary, *args])
    ignored = set(listing(binary, "--ignored") or [])
    tests = [name for name in every if name not in ignored]
    threads = int(os.environ.get("RUST_TEST_THREADS", "8"))
    limit = int(os.environ.get("PER_TEST_TIMEOUT", "300"))
    failed = 0
    with concurrent.futures.ThreadPoolExecutor(threads) as pool:
        for name, passed, output, seconds in pool.map(lambda n: run(binary, n, limit), tests):
            print(f"test {name} ... {'ok' if passed else 'FAILED'}", flush=True)
            if not passed:
                failed += 1
                print(f"---- {name} stdout ----\n{output}", flush=True)
    state = "FAILED" if failed else "ok"
    print(f"test result: {state}. {len(tests) - failed} passed; {failed} failed; {len(ignored)} ignored; 0 measured; 0 filtered out")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
