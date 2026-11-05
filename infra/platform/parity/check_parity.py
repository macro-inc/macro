#!/usr/bin/env python3
"""Fail if two renderings of an instance differ in anything but size.

Environments may differ only in replicas, resources, and volume sizes (see
docs/design/kubernetes-platform.md). Input is two directories of one JSON file per
resource. Prints every other difference, so local cannot silently drift from prod.
"""

import copy
import json
import pathlib
import sys


def scrub(resource):
    """Remove the fields a size profile is allowed to change."""
    resource = copy.deepcopy(resource)
    kind = resource.get("kind")
    if kind == "Deployment":
        resource["spec"].pop("replicas", None)
    if kind in ("Deployment", "Job"):
        for container in resource["spec"]["template"]["spec"]["containers"]:
            container.pop("resources", None)
    if kind == "PersistentVolumeClaim":
        resource["spec"]["resources"]["requests"].pop("storage", None)
    return resource


def differences(left, right, path=""):
    """Every path where two values differ."""
    if isinstance(left, dict) and isinstance(right, dict):
        found = []
        for key in sorted(left.keys() | right.keys()):
            if key not in left or key not in right:
                found.append(f"{path}.{key}: only on one side")
            else:
                found += differences(left[key], right[key], f"{path}.{key}")
        return found
    if isinstance(left, list) and isinstance(right, list):
        if len(left) != len(right):
            return [f"{path}: {len(left)} items against {len(right)}"]
        found = []
        for index, (a, b) in enumerate(zip(left, right)):
            found += differences(a, b, f"{path}[{index}]")
        return found
    return [] if left == right else [f"{path}: {left!r} against {right!r}"]


def compare(left, right):
    """Differences between two renderings: resource name -> resource."""
    found = []
    for name in sorted(left.keys() | right.keys()):
        if name not in left or name not in right:
            found.append(f"{name}: exists on only one side")
        else:
            found += [
                f"{name}{difference}"
                for difference in differences(scrub(left[name]), scrub(right[name]))
            ]
    return found


def load(directory):
    return {
        path.stem: json.loads(path.read_text())
        for path in pathlib.Path(directory).glob("*.json")
    }


def main():
    left, right = load(sys.argv[1]), load(sys.argv[2])
    if not left:
        sys.exit(f"nothing rendered in {sys.argv[1]}")
    found = compare(left, right)
    for difference in found:
        print(difference)
    if found:
        sys.exit(f"{len(found)} differences beyond size")
    print(f"{len(left)} resources match, apart from size")


if __name__ == "__main__":
    main()
