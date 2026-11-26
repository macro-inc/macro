"""Bounded file reads and extraction for the guest runtime updater."""
import os
import stat
import sys
import tarfile


def read(path):
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as file:
        info = os.fstat(file.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > 4096:
            raise ValueError("expected a small regular file")
        data = file.read(4097)
        if len(data) > 4096:
            raise ValueError("file too large")
        sys.stdout.buffer.write(data)


def extract(archive, destination):
    remaining = 2 * 1024**3

    def safe(member, path):
        nonlocal remaining
        if not (member.isfile() or member.isdir() or member.issym()):
            raise ValueError("unsupported runtime archive member")
        if member.mode & (stat.S_ISUID | stat.S_ISGID):
            raise ValueError("privileged mode in runtime archive")
        remaining -= member.size
        if remaining < 0:
            raise ValueError("runtime archive expands past its size limit")
        return tarfile.data_filter(member, path)

    with tarfile.open(archive, "r:") as bundle:
        bundle.extractall(destination, filter=safe)


if __name__ == "__main__":
    try:
        if sys.argv[1] == "read":
            read(sys.argv[2])
        elif sys.argv[1] == "extract":
            extract(sys.argv[2], sys.argv[3])
        else:
            raise ValueError("unknown operation")
    except (OSError, ValueError, tarfile.TarError):
        sys.exit(1)
