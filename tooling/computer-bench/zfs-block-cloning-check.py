#!/usr/bin/env python3
"""Check ZFS block-cloning integrity in a caller-owned parent dataset.

Run as root on a test host. Each run creates one uniquely named brtcheck-*
child, mounts its children in a private mount namespace, and destroys only
that run's datasets. No pool properties or module parameters are changed.

Without compatibility flags, require matching OpenZFS versions and direct
verification reads. Ubuntu test hosts may need --allow-userland-mismatch
--no-direct; those results do not certify reads past the ARC.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import random
import shlex
import subprocess
import sys
import tempfile
import uuid

CHUNK = 1 << 20
PAGE = 4096


class CheckFailure(RuntimeError):
    """A precondition, command, or cleanup failed."""


class CorruptionDetected(CheckFailure):
    """A file differs from the independent expected contents."""


def command(argv: list[str]) -> str:
    result = subprocess.run(argv, capture_output=True, text=True, check=False)
    if result.returncode:
        raise CheckFailure(f"{shlex.join(argv)}: {result.stderr.strip()}")
    return result.stdout.strip()


def version_tuple(version: str) -> tuple[int, ...]:
    return tuple(int(part) for part in version.split("-", 1)[0].split("."))


def preconditions(pool: str, allow_mismatch: bool) -> tuple[str, str]:
    versions = command(["zfs", "version"]).splitlines()
    kernel = next(
        (line.removeprefix("zfs-kmod-") for line in versions if line.startswith("zfs-kmod-")),
        None,
    )
    userland = next(
        (
            line.removeprefix("zfs-")
            for line in versions
            if line.startswith("zfs-") and not line.startswith("zfs-kmod-")
        ),
        None,
    )
    if kernel is None or userland is None:
        raise CheckFailure("Could not read both ZFS versions")
    print(f"OpenZFS kernel {kernel}, userland {userland}", flush=True)
    if version_tuple(kernel) < (2, 2, 4):
        raise CheckFailure("OpenZFS kernel must be at least 2.2.4")
    if version_tuple(userland)[:3] != version_tuple(kernel)[:3]:
        if not allow_mismatch:
            raise CheckFailure("OpenZFS userland and kernel versions differ")
        print("WARNING: userland/kernel mismatch allowed for this test", flush=True)
    for name in ("zfs_bclone_enabled", "zfs_bclone_wait_dirty"):
        if Path(f"/sys/module/zfs/parameters/{name}").read_text().strip() != "1":
            raise CheckFailure(f"{name} must be 1")
    feature = command(["zpool", "get", "-H", "-o", "value", "feature@block_cloning", pool])
    if feature not in ("enabled", "active"):
        raise CheckFailure(f"{pool} block_cloning is {feature}")
    return kernel, userland


def checksum_errors(pool: str) -> int:
    total = 0
    for line in command(["zpool", "status", "-p", pool]).splitlines():
        fields = line.split()
        if (
            len(fields) >= 5
            and fields[1] in ("ONLINE", "DEGRADED", "FAULTED")
            and fields[4].isdigit()
        ):
            total += int(fields[4])
    return total


class FileModel:
    """An immutable source plus the latest page written at each offset."""

    def __init__(self, golden: bytes) -> None:
        self.golden = golden
        self.patches: dict[int, bytes] = {}

    def write(self, offset: int, data: bytes) -> None:
        self.patches[offset] = data

    def chunk(self, index: int) -> bytes:
        start = index * CHUNK
        result = bytearray(self.golden[start : start + CHUNK])
        for offset, data in self.patches.items():
            if start <= offset < start + CHUNK:
                result[offset - start : offset - start + len(data)] = data
        return bytes(result)


def pwrite(path: Path, offset: int, data: bytes, sync: bool = True) -> None:
    fd = os.open(path, os.O_WRONLY)
    try:
        if os.pwrite(fd, data, offset) != len(data):
            raise CheckFailure(f"Short write to {path}")
        if sync:
            os.fsync(fd)
    finally:
        os.close(fd)


def clone_range(source: Path, destination: Path) -> None:
    size = source.stat().st_size
    with source.open("rb") as incoming, destination.open("wb") as outgoing:
        done = 0
        while done < size:
            copied = os.copy_file_range(incoming.fileno(), outgoing.fileno(), size - done)
            if copied == 0:
                raise CheckFailure(f"copy_file_range stopped at {done} of {size}")
            done += copied


def verify(path: Path, model: FileModel, label: str) -> None:
    if path.stat().st_size != len(model.golden):
        raise CorruptionDetected(f"{label}: {path} has the wrong length")
    with path.open("rb") as file:
        for index in range(len(model.golden) // CHUNK):
            actual = file.read(CHUNK)
            expected = model.chunk(index)
            if hashlib.sha256(actual).digest() != hashlib.sha256(expected).digest():
                raise CorruptionDetected(f"{label}: {path} differs in MiB {index}")


def flip_byte(path: Path, offset: int) -> None:
    with path.open("rb") as file:
        file.seek(offset)
        previous = file.read(1)
    if len(previous) != 1:
        raise CheckFailure(f"Cannot inject mismatch at {path}:{offset}")
    pwrite(path, offset, bytes([previous[0] ^ 0xFF]))


def send_receive(snapshot: str, destination: str, direct: list[str]) -> None:
    with tempfile.TemporaryFile() as errors:
        sender = subprocess.Popen(
            ["zfs", "send", "-c", snapshot], stdout=subprocess.PIPE, stderr=errors
        )
        if sender.stdout is None:
            raise CheckFailure("zfs send did not expose stdout")
        try:
            receiver = subprocess.run(
                ["zfs", "receive", "-u", *direct, destination],
                stdin=sender.stdout,
                capture_output=True,
                text=True,
                check=False,
            )
        finally:
            sender.stdout.close()
        sender_status = sender.wait()
        errors.seek(0)
        sender_error = errors.read().decode(errors="replace").strip()
    if sender_status or receiver.returncode:
        raise CheckFailure(f"send/receive: {sender_error} {receiver.stderr.strip()}")


def run(args: argparse.Namespace) -> dict[str, str | int | bool]:
    pool = args.parent_dataset.split("/", 1)[0]
    kernel, userland = preconditions(pool, args.allow_userland_mismatch)
    if command(["zfs", "list", "-H", "-o", "type", args.parent_dataset]) != "filesystem":
        raise CheckFailure("Parent must be an existing filesystem dataset")
    direct = [] if args.no_direct else ["-o", "direct=always"]
    if args.no_direct:
        print("WARNING: verification reads may be served from the ARC", flush=True)
    errors_before = checksum_errors(pool)
    # Atomic creation claims a unique run. Never remove another run's children.
    root = f"{args.parent_dataset}/brtcheck-{uuid.uuid4().hex}"
    command(["zfs", "create", "-o", "canmount=off", root])
    try:
        source_dataset, clone_dataset = (
            f"{root}/{name}" for name in ("source", "clones")
        )
        command(
            ["zfs", "create", "-o", "recordsize=128k", "-o", "compression=lz4", *direct, source_dataset]
        )
        command(
            ["zfs", "create", "-o", "recordsize=16k", "-o", "compression=lz4", *direct, clone_dataset]
        )
        source_mount = Path(command(["zfs", "get", "-H", "-o", "value", "mountpoint", source_dataset]))
        clone_mount = Path(command(["zfs", "get", "-H", "-o", "value", "mountpoint", clone_dataset]))
        size = args.size_mib * CHUNK
        rng = random.Random(20261117)
        initial = bytearray(os.urandom(size))
        for _ in range(args.size_mib // 8):
            offset = rng.randrange(0, size - 4 * CHUNK) // PAGE * PAGE
            length = rng.randrange(1, 4) * CHUNK
            initial[offset : offset + length] = bytes(length)
        golden = bytes(initial)
        del initial
        source = source_mount / "golden"
        # Closing without fsync exercises cloning while the source is dirty.
        source.write_bytes(golden)
        files: list[tuple[Path, FileModel]] = []
        for index in range(args.clones):
            if index % 2 == 0:
                path = source_mount / f"clone{index}"
                command(["cp", "--reflink=always", str(source), str(path)])
            else:
                path = clone_mount / f"clone{index}"
                clone_range(source, path)
            files.append((path, FileModel(golden)))
        command(["zpool", "sync", pool])
        clone_bytes = command(["zpool", "get", "-H", "-p", "-o", "value", "bcloneused", pool])
        print(f"bcloneused {clone_bytes} bytes after {args.clones} clones", flush=True)
        targets = files + [(source, FileModel(golden))]
        for index in range(args.writes):
            path, model = targets[rng.randrange(len(targets))]
            offset = rng.randrange(0, size // PAGE) * PAGE
            data = hashlib.sha256(f"{path}:{index}".encode()).digest() * (PAGE // 32)
            pwrite(path, offset, data, sync=index % 7 == 0)
            model.write(offset, data)
        if args.self_test:
            flip_byte(files[-1][0], size // 2 + 123)
            print("self-test: flipped a byte; verification must fail", flush=True)
        command(["zpool", "sync", pool])
        for path, model in targets:
            verify(path, model, "after writes")
        print(f"Verified {len(targets)} files after {args.writes} writes", flush=True)
        for dataset, mount, label in (
            (source_dataset, source_mount, "source"),
            (clone_dataset, clone_mount, "clones"),
        ):
            snapshot = f"{dataset}@check"
            received = f"{root}/received-{label}"
            command(["zfs", "snapshot", snapshot])
            send_receive(snapshot, received, direct)
            receive_mount = Path(
                command(["zfs", "get", "-H", "-o", "value", "mountpoint", received])
            )
            if command(["zfs", "get", "-H", "-o", "value", "mounted", received]) != "yes":
                command(["zfs", "mount", received])
            for path, model in targets:
                if path.parent == mount:
                    verify(receive_mount / path.name, model, "after send/receive")
        print(f"Verified all {len(targets)} received copies", flush=True)
        errors_after = checksum_errors(pool)
        if errors_after != errors_before:
            raise CheckFailure(f"{pool} checksum errors changed: {errors_before} -> {errors_after}")
        result: dict[str, str | int | bool] = {
            "ok": True,
            "kernel_version": kernel,
            "userland_version": userland,
            "versions_match": version_tuple(kernel)[:3] == version_tuple(userland)[:3],
            "direct_reads": not args.no_direct,
            "clones": args.clones,
            "size_mib": args.size_mib,
            "writes": args.writes,
            "checksum_errors_before": errors_before,
            "checksum_errors_after": errors_after,
        }
    finally:
        command(["zfs", "destroy", "-r", root])
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("parent_dataset", help="an existing dataset owned by the caller")
    parser.add_argument("--clones", type=int, default=8)
    parser.add_argument("--size-mib", type=int, default=256)
    parser.add_argument("--writes", type=int, default=2000)
    parser.add_argument("--allow-userland-mismatch", action="store_true", help="test hosts only")
    parser.add_argument("--no-direct", action="store_true", help="verification may read from the ARC")
    parser.add_argument("--self-test", action="store_true", help="inject a mismatch; expect exit 1")
    args = parser.parse_args()
    if args.clones < 2 or args.size_mib < 1 or args.writes < 0:
        parser.error("require clones >= 2, size-mib >= 1, and writes >= 0")
    if os.geteuid() != 0:
        parser.error("run as root")
    if os.environ.get("BRT_CHECK_IN_NAMESPACE") != "1":
        os.execvp(
            "unshare",
            [
                "unshare", "-m", "--propagation", "private", "env",
                "BRT_CHECK_IN_NAMESPACE=1", sys.executable, *sys.argv,
            ],
        )
    try:
        result = run(args)
    except (CheckFailure, OSError, ValueError, subprocess.SubprocessError) as error:
        print(f"FAIL: {error}", flush=True)
        print(json.dumps({
            "ok": False,
            "corruption_detected": isinstance(error, CorruptionDetected),
            "self_test_requested": args.self_test,
            "error": str(error),
        }))
        return 1
    print("PASS", flush=True)
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
