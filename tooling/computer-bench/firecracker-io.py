#!/usr/bin/env python3
"""Disk work inside a Firecracker macro-box computer, through the host agent's CLI.

    firecracker-io.py <out.jsonl> <uuid> <label> [--runs N] [--host-cli CMD] [--image IMAGE] [--network]

Creates computer <uuid> (4 vCPU / 8 GiB / 32 GiB root / 32 GiB home), runs the
workloads below N times in /home (the computer's own disk), destroys it, and
appends one JSON line per run to <out.jsonl>, tagged with <label> (say the
agent's storage backend: xfs-reflink or zfs-blockclone). The storage backend
is the agent's configuration, not a flag here.

Workloads (seconds unless noted):
  fsync     2000 x (4 KiB append + fsync), per-call latency p50/p99 in ms
  sqlite    1000 single-row INSERT transactions, journal_mode=DELETE, synchronous=FULL
  busybox   untar busybox 1.37 (copied into /home from the host's nix store first, untimed),
            make defconfig (CONFIG_TC off: it needs headers the guest lacks), make -j<nproc>,
            sync; then rm -rf + sync
  --network adds what needs the guest's network:
  nix       substitute zstd and its build inputs (network), then `nix build --rebuild` zstd
            (local build into the store, which is on the root disk)
  cargo     cargo build --release of ripgrep 14.1.1 after `cargo fetch` (fetch timed apart)

Run it under the host's timed lock for numbers (timed.sh); unlocked runs are functional.
"""

import argparse
import json
import os
import shlex
import subprocess
import sys
import time

GUEST_IO = r"""
import json, os, sqlite3, statistics, sys, time
d = "/home/fc-io"
os.makedirs(d, exist_ok=True)
out = {}
# fsync: 4 KiB appends, each made durable
lat = []
fd = os.open(f"{d}/fsync.bin", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
block = os.urandom(4096)
t0 = time.monotonic()
for _ in range(2000):
    t = time.monotonic()
    os.write(fd, block)
    os.fsync(fd)
    lat.append((time.monotonic() - t) * 1000)
total = time.monotonic() - t0
os.close(fd)
os.unlink(f"{d}/fsync.bin")
lat.sort()
out["fsync"] = {"s": round(total, 3), "p50_ms": round(lat[len(lat) // 2], 3),
                "p99_ms": round(lat[int(len(lat) * 0.99)], 3), "max_ms": round(lat[-1], 3)}
# sqlite: one transaction per row, rollback journal, full sync
path = f"{d}/bench.db"
for suffix in ("", "-journal"):
    if os.path.exists(path + suffix):
        os.unlink(path + suffix)
db = sqlite3.connect(path, isolation_level=None)
db.execute("PRAGMA journal_mode=DELETE")
db.execute("PRAGMA synchronous=FULL")
db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, v BLOB)")
t0 = time.monotonic()
for i in range(1000):
    db.execute("BEGIN")
    db.execute("INSERT INTO t (v) VALUES (?)", (os.urandom(200),))
    db.execute("COMMIT")
out["sqlite"] = {"s": round(time.monotonic() - t0, 3), "tx_per_s": round(1000 / (time.monotonic() - t0), 1)}
db.close()
os.unlink(path)
print(json.dumps(out))
"""

BUSYBOX = r"""
set -euo pipefail
d=/home/fc-io/bb
rm -rf "$d"; mkdir -p "$d"; cd "$d"
s() { date +%s.%N; }
t0=$(s); tar xjf /home/fc-io/busybox.tar.bz2 --strip-components=1; sync; t1=$(s)
make defconfig >/dev/null 2>&1
sed -i 's/^CONFIG_TC=y/# CONFIG_TC is not set/' .config
make oldconfig </dev/null >/dev/null 2>&1
t2=$(s); make -j"$(nproc)" >/tmp/fc-io-busybox.log 2>&1; sync; t3=$(s)
files=$(find . -type f | wc -l); mib=$(du -sm . | cut -f1)
cd /; t4=$(s); rm -rf "$d"; sync; t5=$(s)
awk -v a="$t0" -v b="$t1" -v c="$t2" -v e="$t3" -v f="$t4" -v g="$t5" -v n="$files" -v m="$mib" \
  'BEGIN { printf "{\"untar_s\":%.3f,\"make_s\":%.3f,\"rm_s\":%.3f,\"files\":%d,\"tree_mib\":%d}\n", b-a, e-c, g-f, n, m }'
"""

NIX = r"""
set -euo pipefail
s() { date +%s.%N; }
# Substitute zstd and everything its build needs, then rebuild it locally: the rebuild is CPU + store disk only.
t0=$(s); nix build --no-link nixpkgs#zstd nixpkgs#zstd.inputDerivation >/tmp/fc-io-nix.log 2>&1; t1=$(s)
nix build --no-link --rebuild nixpkgs#zstd >>/tmp/fc-io-nix.log 2>&1; sync; t2=$(s)
awk -v a="$t0" -v b="$t1" -v c="$t2" 'BEGIN { printf "{\"substitute_s\":%.3f,\"rebuild_s\":%.3f}\n", b-a, c-b }'
"""

CARGO = r"""
set -euo pipefail
d=/home/fc-io/rg
rm -rf "$d"; mkdir -p "$d"; cd "$d"
s() { date +%s.%N; }
t0=$(s)
nix shell nixpkgs#cargo nixpkgs#gcc nixpkgs#git -c bash -c '
  git clone -q --depth 1 --branch 14.1.1 https://github.com/BurntSushi/ripgrep . && cargo fetch -q' >/tmp/fc-io-cargo.log 2>&1
t1=$(s)
nix shell nixpkgs#cargo nixpkgs#gcc -c cargo build --release --offline -q >>/tmp/fc-io-cargo.log 2>&1; sync; t2=$(s)
cd /; rm -rf "$d"; sync
awk -v a="$t0" -v b="$t1" -v c="$t2" 'BEGIN { printf "{\"fetch_s\":%.3f,\"build_s\":%.3f}\n", b-a, c-b }'
"""


def host_cli(args, *argv, stdin=None, timeout=60):
    """Run the agent CLI. Retries an exec on transport errors: the agent restarts now and then
    (connection refused) and exec has a known TLS close_notify flake."""
    for attempt in range(30):
        try:
            proc = subprocess.run(
                [*shlex.split(args.host_cli), *argv],
                input=stdin,
                stdin=None if stdin is not None else subprocess.DEVNULL,
                capture_output=True,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            time.sleep(2)
            continue
        transport = b"Connection refused" in proc.stderr or b"close_notify" in proc.stderr
        if proc.returncode == 0 or argv[0] != "exec" or not transport:
            return proc
        time.sleep(2)
    return proc


def guest(args, name, script, interpreter="bash"):
    """Run SCRIPT in the guest as a transient systemd unit, so an agent restart cannot cut it
    short, then poll for its exit code and return the JSON line it printed."""
    job = f"/tmp/fc-io/{name}"
    host_cli(
        args,
        "exec",
        "--root",
        args.uuid,
        "--",
        "bash",
        "-c",
        f"mkdir -p /tmp/fc-io && rm -f {job}.* && cat > {job}.job",
        stdin=script.encode(),
    )
    started = host_cli(
        args,
        "exec",
        "--root",
        args.uuid,
        "--",
        "systemd-run",
        "--collect",
        f"--unit=fc-io-{name}",
        "--setenv=HOME=/root",
        "bash",
        "-lc",
        f"{interpreter} {job}.job > {job}.out 2> {job}.err; echo $? > {job}.rc",
    )
    if started.returncode != 0:
        return {"error": "start", "stderr": started.stderr.decode(errors="replace")[-500:]}
    while True:
        time.sleep(2)
        done = host_cli(args, "exec", "--root", args.uuid, "--", "bash", "-c", f"cat {job}.rc 2>/dev/null")
        if done.returncode == 0 and done.stdout.strip():
            break
    rc = int(done.stdout.strip())
    result = host_cli(
        args, "exec", "--root", args.uuid, "--", "bash", "-c", f"tail -n 1 {job}.out; tail -c 500 {job}.err >&2"
    )
    if rc != 0:
        return {"error": rc, "stderr": result.stderr.decode(errors="replace")}
    return json.loads(result.stdout.decode().strip().splitlines()[-1])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("out")
    parser.add_argument("uuid")
    parser.add_argument("label")
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument(
        "--host-cli",
        default=os.environ.get("FIRECRACKER_HOST_CLI", "firecracker-host client"),
        help="the host agent's client command (FIRECRACKER_HOST_CLI)",
    )
    parser.add_argument("--image", default="macro-box/2026-11-17b")
    parser.add_argument("--busybox", required=True, help="busybox source tarball (.tar.bz2)")
    parser.add_argument("--network", action="store_true")
    args = parser.parse_args()

    host_cli(args, "destroy", args.uuid, timeout=300)
    t = time.time()
    created = host_cli(
        args,
        "create",
        args.uuid,
        "--image",
        args.image,
        "--vcpus",
        "4",
        "--memory-mib",
        "8192",
        "--root-disk-gib",
        "32",
        "--home-disk-gib",
        "32",
        "--role",
        "person",
        timeout=300,
    )
    if created.returncode != 0:
        sys.exit(f"create failed: {created.stderr.decode(errors='replace')}")
    create_s = time.time() - t
    # The guest agent listens a moment after create returns.
    deadline = time.time() + 120
    while True:
        try:
            if host_cli(args, "exec", "--root", args.uuid, "--", "bash", "-c", "true", timeout=10).returncode == 0:
                break
        except subprocess.TimeoutExpired:
            pass
        if time.time() > deadline:
            sys.exit("guest agent never answered")
        time.sleep(0.2)
    exec_ready_s = time.time() - t
    # Record which agent build the numbers come from.
    host = host_cli(args, "host")
    agent_version = json.loads(host.stdout).get("agentVersion") if host.returncode == 0 else None
    # The busybox source goes into the guest once, untimed.
    with open(args.busybox, "rb") as tarball:
        host_cli(
            args,
            "exec",
            "--root",
            args.uuid,
            "--",
            "bash",
            "-c",
            "mkdir -p /home/fc-io && cat > /home/fc-io/busybox.tar.bz2",
            stdin=tarball.read(),
        )
    try:
        for run in range(1, args.runs + 1):
            record = {
                "label": args.label,
                "image": args.image,
                "run": run,
                "create_s": round(create_s, 3),
                "exec_ready_s": round(exec_ready_s, 3),
                "agent_version": agent_version,
                "loadavg_start": open("/proc/loadavg").read().split()[:3],
            }
            record.update(guest(args, f"io-{run}", GUEST_IO, interpreter="python3"))
            record["busybox"] = guest(args, f"busybox-{run}", BUSYBOX)
            if args.network:
                record["nix"] = guest(args, f"nix-{run}", NIX)
                record["cargo"] = guest(args, f"cargo-{run}", CARGO)
            record["loadavg_end"] = open("/proc/loadavg").read().split()[:3]
            print(json.dumps(record), flush=True)
            with open(args.out, "a") as out:
                out.write(json.dumps(record) + "\n")
    finally:
        host_cli(args, "destroy", args.uuid, timeout=300)


if __name__ == "__main__":
    main()
