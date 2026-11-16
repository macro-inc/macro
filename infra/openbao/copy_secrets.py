#!/usr/bin/env python3
"""Copy Passwords values from the legacy hosted dev vault to its replacement.

Both vaults answer as https://openbao-dev.macro-internal.com, each through its
own operator tunnel (`--source-connect`, `--destination-connect`), with TLS
verified against that name. For every provisioned team namespace it copies the
`passwords` KV v2 mount version by version, so each item keeps the version
numbers the document storage service's metadata points at.

It only moves the destination forward. A version it already has is checked
against the source and never rewritten; a version the source has destroyed or
deleted since is destroyed or deleted there too. A destination that is ahead
(written to after the name moved) is fine as long as the versions both have
match. Anything else is reported as diverged and left alone. Runs are
idempotent; a repeat run copies only what changed. `--dry-run` writes nothing
and reports what a run would do. Output is counts and item ids only, never
values.

TOTP seeds are write-only in OpenBao, so they can't be copied; the report counts
them per team.
"""

import argparse
import os
import sys
from uuid import UUID

from openbao_provisioning import OpenBaoRequestError
from provision import HostedOpenBao, parse_connect

MOUNT = "passwords"
TOTP_MOUNT = "totp"
# Written for a version whose value the source no longer has (destroyed,
# deleted, or pruned past max_versions), then given the same state.
PLACEHOLDER = {"copied_placeholder": "true"}


class CopyError(RuntimeError):
    """A run that must stop before or without writing; carries no values."""


def list_keys(client, path, namespace):
    response = client.request("LIST", path, namespace=namespace, missing=True)
    return [] if response is None else response["data"]["keys"]


def item_paths(client, namespace, prefix=""):
    """Every KV v2 item path under the mount, depth first."""
    paths = []
    for key in list_keys(client, f"{MOUNT}/metadata/{prefix}", namespace):
        if key.endswith("/"):
            paths.extend(item_paths(client, namespace, prefix + key))
        else:
            paths.append(prefix + key)
    return paths


def team_namespaces(client):
    return sorted(
        key.rstrip("/")
        for key in list_keys(client, "sys/namespaces", None)
        if key.startswith("team-")
    )


def version_state(metadata, version):
    """`live`, `destroyed`, `deleted`, or `pruned` for one version number."""
    entry = metadata["versions"].get(str(version))
    if entry is None:
        return "pruned"
    if entry["destroyed"]:
        return "destroyed"
    if entry["deletion_time"]:
        return "deleted"
    return "live"


def read_version(client, namespace, path, version):
    response = client.request("GET", f"{MOUNT}/data/{path}?version={version}", namespace=namespace)
    return response["data"]["data"]


def metadata(client, namespace, path):
    response = client.request("GET", f"{MOUNT}/metadata/{path}", namespace=namespace, missing=True)
    return None if response is None else response["data"]


def write_version(client, namespace, path, version, state, value):
    """Append `version` with CAS on the one before it, then match its state."""
    written = client.request("POST", f"{MOUNT}/data/{path}", {
        "options": {"cas": version - 1},
        "data": value,
    }, namespace)["data"]["version"]
    if written != version:
        raise CopyError(f"{namespace}/{path}: destination wrote version {written}, expected {version}")
    apply_state(client, namespace, path, version, state)


# The state changes the destination may follow: a value can be erased later,
# never brought back.
FORWARD = {("live", "destroyed"), ("live", "deleted"), ("deleted", "destroyed"), ("live", "pruned")}


def plan_item(source, destination, namespace, path, source_metadata, destination_metadata):
    """What the destination needs: the first version to copy, state changes, and
    whether it is ahead. None when the shared versions differ."""
    present = 0 if destination_metadata is None else destination_metadata["current_version"]
    current = source_metadata["current_version"]
    changes = []
    for version in range(1, min(present, current) + 1):
        wanted = version_state(source_metadata, version)
        have = version_state(destination_metadata, version)
        if have == "pruned" and wanted in ("pruned", "destroyed"):
            continue
        if (have, wanted) in FORWARD:
            changes.append((version, wanted))
        elif have != wanted:
            return None
        elif wanted == "live" and (
            read_version(source, namespace, path, version)
            != read_version(destination, namespace, path, version)
        ):
            return None
    return {"first": present + 1, "changes": changes, "ahead": present > current}


def apply_state(client, namespace, path, version, state):
    if state in ("destroyed", "pruned"):
        client.request("POST", f"{MOUNT}/destroy/{path}", {"versions": [version]}, namespace)
    elif state == "deleted":
        client.request("POST", f"{MOUNT}/delete/{path}", {"versions": [version]}, namespace)


def copy_team(source, destination, namespace, dry_run):
    """Copy one namespace; returns counts and the ids of items left alone."""
    report = {"items": 0, "versions_copied": 0, "versions_present": 0, "states_changed": 0,
              "ahead": 0, "diverged": [],
              "totp_keys": len(list_keys(source, f"{TOTP_MOUNT}/keys", namespace))}
    for path in item_paths(source, namespace):
        report["items"] += 1
        source_metadata = metadata(source, namespace, path)
        destination_metadata = metadata(destination, namespace, path)
        plan = plan_item(source, destination, namespace, path, source_metadata, destination_metadata)
        if plan is None:
            report["diverged"].append(path)
            continue
        report["ahead"] += plan["ahead"]
        report["versions_present"] += min(plan["first"] - 1, source_metadata["current_version"])
        report["states_changed"] += len(plan["changes"])
        missing = range(plan["first"], source_metadata["current_version"] + 1)
        report["versions_copied"] += len(missing)
        if dry_run:
            continue
        for version, state in plan["changes"]:
            apply_state(destination, namespace, path, version, state)
        for version in missing:
            state = version_state(source_metadata, version)
            value = read_version(source, namespace, path, version) if state == "live" else PLACEHOLDER
            write_version(destination, namespace, path, version, state, value)
    return report


def verify_team(source, destination, namespace):
    """Item ids still out of step, and how many items only the destination has."""
    source_paths = item_paths(source, namespace)
    known = set(source_paths)
    only_in_destination = sum(path not in known for path in item_paths(destination, namespace))
    mismatched = []
    for path in source_paths:
        source_metadata = metadata(source, namespace, path)
        destination_metadata = metadata(destination, namespace, path)
        plan = plan_item(source, destination, namespace, path, source_metadata, destination_metadata)
        if plan is None or plan["changes"] or plan["first"] <= source_metadata["current_version"]:
            mismatched.append(path)
    return mismatched, only_in_destination


def check_vaults(source, destination, namespaces):
    """Refuse one vault twice, or a destination missing a team's provisioning."""
    source_cluster = source.request("GET", "sys/health")["cluster_id"]
    if source_cluster == destination.request("GET", "sys/health")["cluster_id"]:
        raise CopyError("source and destination are the same vault; check the two tunnels")
    missing = []
    for namespace in namespaces:
        mounts = destination.request("GET", "sys/mounts", namespace=namespace, missing=True)
        if mounts is None or f"{MOUNT}/" not in mounts["data"]:
            missing.append(namespace)
    if missing:
        raise CopyError("provision these teams in the destination first: " + ", ".join(missing))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source-connect", required=True, type=parse_connect,
                        help="loopback host:port of the legacy vault's operator tunnel")
    parser.add_argument("--destination-connect", required=True, type=parse_connect,
                        help="loopback host:port of the new vault's operator tunnel")
    parser.add_argument("--team-id", action="append", type=UUID,
                        help="copy only this team (repeatable); default: every team in the source")
    parser.add_argument("--dry-run", action="store_true", help="write nothing; report what would be copied")
    arguments = parser.parse_args()
    if arguments.source_connect == arguments.destination_connect:
        parser.error("--source-connect and --destination-connect must be different tunnels")
    source_token = os.environ.get("BAO_SOURCE_TOKEN")
    destination_token = os.environ.get("BAO_DESTINATION_TOKEN")
    if not source_token or not destination_token:
        parser.error("BAO_SOURCE_TOKEN and BAO_DESTINATION_TOKEN are required (from Doppler; never as arguments)")

    source = HostedOpenBao(source_token, arguments.source_connect)
    destination = HostedOpenBao(destination_token, arguments.destination_connect)
    namespaces = (
        [f"team-{team}" for team in arguments.team_id] if arguments.team_id else team_namespaces(source)
    )
    check_vaults(source, destination, namespaces)

    failed = False
    for namespace in namespaces:
        report = copy_team(source, destination, namespace, arguments.dry_run)
        mismatched, only_in_destination = (
            ([], 0) if arguments.dry_run else verify_team(source, destination, namespace)
        )
        verb = "would copy" if arguments.dry_run else "copied"
        print(f"{namespace}: {report['items']} items, {verb} {report['versions_copied']} versions, "
              f"{report['versions_present']} already present, "
              f"{report['states_changed']} versions erased since, "
              f"{report['ahead']} items ahead in the destination, "
              f"{only_in_destination} items only in the destination, "
              f"{report['totp_keys']} TOTP keys not copyable")
        for path in report["diverged"]:
            print(f"  diverged, left alone: {path}")
        for path in mismatched:
            if path not in report["diverged"]:
                print(f"  verify failed: {path}")
        failed = failed or bool(report["diverged"] or mismatched)
    if failed:
        sys.exit(2)


if __name__ == "__main__":
    try:
        main()
    except (CopyError, OpenBaoRequestError, ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
