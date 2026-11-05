#!/usr/bin/env python3
"""Compares the tests a nextest job log ran with the tests in a bazel-testlogs tree.

Usage: parity.py <nextest job log with colour codes stripped> <bazel-testlogs>

Compares "package test-name" pairs. nextest prefixes the package and, for integration
tests and bins, the binary; Bazel's logs have the target directory. Only the package and
test name are compared, so a test that moved between binaries of a package still matches.
"""
import os
import re
import sys

PASS = re.compile(r"(?:PASS|FAIL|SKIP|FLAKY|LEAK|SLOW)\s*\[[^\]]*\]\s*(?:\([^)]*\)\s*)?(\S+) (\S+)")


def nextest_tests(path):
    tests = set()
    for line in open(path, errors="replace"):
        match = PASS.search(line)
        if match:
            tests.add((match.group(1).split("::")[0].replace("-", "_"), match.group(2)))
    return tests


def bazel_tests(root):
    tests = set()
    line_re = re.compile(r"^test (\S+) (?:- should panic )?\.\.\. ", re.M)
    for base, _, files in os.walk(root, followlinks=True):
        if "test.log" not in files:
            continue
        package = os.path.basename(os.path.dirname(base))
        package = package.replace("-", "_")
        text = open(os.path.join(base, "test.log"), errors="replace").read()
        tests |= {(package, name) for name in line_re.findall(text)}
    return tests


def main():
    wanted = nextest_tests(sys.argv[1])
    got = bazel_tests(sys.argv[2])
    packages = {p for p, _ in wanted}
    got_in_scope = {t for t in got if t[0] in packages}
    missing = wanted - got
    extra = got_in_scope - wanted
    print(f"nextest {len(wanted)} tests, bazel {len(got)} ({len(got_in_scope)} in the same packages)")
    print(f"missing from bazel: {len(missing)}; only in bazel, same packages: {len(extra)}")
    by_package = {}
    for package, _ in missing:
        by_package[package] = by_package.get(package, 0) + 1
    for package, count in sorted(by_package.items(), key=lambda item: -item[1])[:25]:
        print(f"  missing {count} in {package}")
    for test in sorted(missing)[:15]:
        print("  e.g.", *test)


if __name__ == "__main__":
    main()
