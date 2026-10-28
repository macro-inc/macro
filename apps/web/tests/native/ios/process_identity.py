"""Darwin process birth timestamp; invoked using isolated Xcode Python by smoke.py."""

import ctypes
from datetime import datetime, timedelta, timezone
import os
import sys


class ProcBSDInfo(ctypes.Structure):
    # Darwin sys/proc_info.h, PROC_PIDTBSDINFO. `ps lstart` loses microseconds.
    _fields_ = [
        (name, ctypes.c_uint32) for name in (
            "flags", "status", "xstatus", "pid", "ppid", "uid", "gid",
            "ruid", "rgid", "svuid", "svgid", "reserved",
        )
    ] + [
        ("comm", ctypes.c_char * 16), ("name", ctypes.c_char * 32),
        ("nfiles", ctypes.c_uint32), ("pgid", ctypes.c_uint32),
        ("jobc", ctypes.c_uint32), ("tdev", ctypes.c_uint32),
        ("tpgid", ctypes.c_uint32), ("nice", ctypes.c_int32),
        ("start_seconds", ctypes.c_uint64), ("start_microseconds", ctypes.c_uint64),
    ]


def start_time(pid):
    libproc = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
    query = libproc.proc_pidinfo
    query.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
    query.restype = ctypes.c_int
    info = ProcBSDInfo()
    size = query(pid, 3, 0, ctypes.byref(info), ctypes.sizeof(info))
    if size != ctypes.sizeof(info):
        error = ctypes.get_errno()
        raise OSError(error, f"Cannot read process identity for PID {pid}: {os.strerror(error)}")
    # SZOMB and PROC_FLAG_INEXIT, respectively. Signal 0 accepts zombies.
    if info.status == 5 or info.flags & 4:
        raise ProcessLookupError(f"Macro PID {pid} is exiting or a zombie")
    if info.pid != pid or (info.name or info.comm) != b"macro":
        raise AssertionError(f"PID {pid} no longer belongs to Macro")
    return datetime.fromtimestamp(info.start_seconds, timezone.utc) + timedelta(
        microseconds=info.start_microseconds
    )


if __name__ == "__main__":
    print(start_time(int(sys.argv[1])).isoformat())
