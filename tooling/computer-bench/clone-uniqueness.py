#!/usr/bin/env python3
"""Two computers restored from one golden must not share identities or random values.

    clone-uniqueness.py <uuid-a> <uuid-b> [--host-cli CMD] [--image IMAGE] [--out FILE] [--keep]

Creates computers <uuid-a> and <uuid-b> from the same golden through the host
agent's CLI, reads every long-lived id and a fresh random value from several
generators in each, destroys both (unless --keep), and fails if a value that
must differ is equal. Values that are identical by design (the kernel boot id
of the one golden boot, the invocation ids of units that were already running
at the snapshot) are reported, not failed. Prints one JSON object; --out also
writes it.

Run on the Firecracker host as root (it reads the computers' DNS traffic from
their network namespaces). Functional, not timed: no lock needed.
"""

import argparse
import json
import os
import shlex
import subprocess
import sys
import tempfile

# name -> (shell run as root in the guest, must differ across clones)
PROBES = {
    "machine_id": ("cat /etc/machine-id", True),
    "kernel_uuid": ("cat /proc/sys/kernel/random/uuid", True),
    "getrandom_32": ("python3 -c 'import os; print(os.urandom(32).hex())'", True),
    "openssl_rand_32": ("openssl rand -hex 32 2>/dev/null || echo unavailable", True),
    "node_random_uuid": (
        "node -e 'console.log(require(\"crypto\").randomUUID())' 2>/dev/null || echo unavailable",
        True,
    ),
    "node_random_bytes_32": (
        'node -e \'console.log(require("crypto").randomBytes(32).toString("hex"))\' 2>/dev/null || echo unavailable',
        True,
    ),
    # sd-bus answers Peer.GetMachineId from a per-process cache: a daemon alive
    # since the snapshot may still report the golden's machine id.
    "logind_peer_machine_id": (
        "busctl call org.freedesktop.login1 /org/freedesktop/login1 org.freedesktop.DBus.Peer GetMachineId | cut -d'\"' -f2",
        True,
    ),
    "resolved_peer_machine_id": (
        "busctl call org.freedesktop.resolve1 /org/freedesktop/resolve1 org.freedesktop.DBus.Peer GetMachineId | cut -d'\"' -f2",
        True,
    ),
    "resolved_dns_over_tls": (
        "resolvectl dns-over-tls 2>/dev/null | awk '{print $NF}' | sort -u | tr '\\n' ' '",
        False,
    ),
    "dbus_bus_id": (
        "busctl call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetId | cut -d'\"' -f2",
        False,
    ),
    "journal_seqnum_id": (
        "journalctl --header --file /var/log/journal/$(cat /etc/machine-id)/system.journal 2>/dev/null | awk -F': *' '/Sequential number ID/{print $2}' || echo none",
        True,
    ),
    "journal_current_boot": (
        "journalctl --list-boots -o json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)[-1][\"boot_id\"])'",
        False,
    ),
    "kernel_boot_id": ("cat /proc/sys/kernel/random/boot_id", False),
    "invocation_snapshot_unit": ("systemctl show -p InvocationID --value systemd-resolved.service", False),
    "invocation_restarted_unit": ("systemctl show -p InvocationID --value systemd-journald.service", True),
    "invocation_after_restore_unit": ("systemctl show -p InvocationID --value harnessd.service", True),
    "docker_id": ("systemctl is-active -q docker && docker info -f '{{.ID}}' || echo not-running", True),
    "containerd_active": ("systemctl is-active containerd 2>/dev/null || true", False),
}


def host(cli, *args, stdin=None):
    return subprocess.run(shlex.split(cli) + list(args), input=stdin, capture_output=True, text=True, check=False)


def guest(cli, computer, script):
    result = host(cli, "exec", "--root", computer, "bash", "-lc", script, stdin="")
    return result.stdout.strip().splitlines()[-1] if result.stdout.strip() else f"error: {result.stderr.strip()[-200:]}"


def firecracker_pid(computer):
    needle = "c-" + computer.replace("-", "")
    out = subprocess.run(["pgrep", "-f", "--", f"--id {needle}"], capture_output=True, text=True).stdout.split()
    return out[0] if out else None


def dns_ids(cli, computer):
    """DNS query ids and source ports the guest's resolver (systemd-resolved, alive since the snapshot) sends."""
    pid = firecracker_pid(computer)
    if not pid:
        return []
    names = " ".join(f"u{n}-clone-uniqueness.example.com" for n in range(4))
    sniff = subprocess.Popen(
        [
            "nsenter",
            "-t",
            pid,
            "-n",
            "timeout",
            "12",
            "tcpdump",
            "-l",
            "-n",
            "-i",
            "tap0",
            "-c",
            "4",
            "udp dst port 53",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    guest(cli, computer, f"for n in {names}; do resolvectl query --cache=no $n >/dev/null 2>&1; done; echo done")
    out, _ = sniff.communicate()
    ids = []
    for line in out.splitlines():
        # 12:00:00.000 IP 172.16.0.2.53012 > 1.1.1.1.53: 41234+ A? ...
        parts = line.split()
        if len(parts) > 5 and parts[1] == "IP":
            ids.append(f"{parts[2].rsplit('.', 1)[-1]}/{parts[5].rstrip('+').rstrip(':')}")
    return ids


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("a")
    parser.add_argument("b")
    parser.add_argument(
        "--host-cli",
        default=os.environ.get("FIRECRACKER_HOST_CLI", "firecracker-host client"),
        help="the host agent's client command (FIRECRACKER_HOST_CLI)",
    )
    parser.add_argument(
        "--image",
        default=os.environ.get("FIRECRACKER_IMAGE"),
        required="FIRECRACKER_IMAGE" not in os.environ,
        help="the macro-box image both computers restore from (FIRECRACKER_IMAGE)",
    )
    parser.add_argument("--out")
    parser.add_argument("--keep", action="store_true")
    args = parser.parse_args()

    with tempfile.NamedTemporaryFile("w", suffix=".json") as enrollment:
        enrollment.write("{}")
        enrollment.flush()
        for computer in (args.a, args.b):
            created = host(
                args.host_cli,
                "create",
                "--image",
                args.image,
                "--role",
                "person",
                "--vcpus",
                "4",
                "--memory-mib",
                "8192",
                "--home-disk-gib",
                "4",
                "--enrollment-file",
                enrollment.name,
                computer,
                stdin="",
            )
            if created.returncode != 0:
                sys.exit(f"create {computer} failed: {created.stderr.strip()[-400:]}")
    try:
        values = {}
        for name, (script, _) in PROBES.items():
            values[name] = {"a": guest(args.host_cli, args.a, script), "b": guest(args.host_cli, args.b, script)}
        values["resolved_dns_port_and_id"] = {"a": dns_ids(args.host_cli, args.a), "b": dns_ids(args.host_cli, args.b)}
    finally:
        if not args.keep:
            for computer in (args.a, args.b):
                host(args.host_cli, "destroy", computer, stdin="")

    failures, same_by_design = [], []
    for name, pair in values.items():
        must_differ = PROBES[name][1] if name in PROBES else True
        a, b = pair["a"], pair["b"]
        if isinstance(a, list):
            equal = bool(set(a) & set(b))
        else:
            equal = a == b and a not in ("unavailable", "not-running", "none", "") and not a.startswith("error")
        if equal and must_differ:
            failures.append(name)
        elif equal:
            same_by_design.append(name)
    report = {"image": args.image, "values": values, "failures": failures, "same_by_design": same_by_design}
    text = json.dumps(report, indent=2)
    print(text)
    if args.out:
        with open(args.out, "w") as handle:
            handle.write(text + "\n")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
