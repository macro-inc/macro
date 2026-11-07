#!/usr/bin/env python3
"""Run inside a guest: readiness probes must not blacklist the screen relay."""
import socket

for _ in range(16):
    with socket.create_connection(("127.0.0.1", 5900), timeout=5) as probe:
        with probe.makefile("rb") as stream:
            stream.read(12)

with socket.create_connection(("127.0.0.1", 5900), timeout=5) as viewer:
    stream = viewer.makefile("rb")
    banner = stream.read(12)
    assert banner == b"RFB 003.008\n", banner
    viewer.sendall(banner)
    count = stream.read(1)[0]
    assert count > 0, "display rejected the local viewer"
    security = stream.read(count)
    assert 1 in security, security
    viewer.sendall(b"\x01")
    assert stream.read(4) == b"\x00\x00\x00\x00", "no-auth handshake failed"
print("Display accepts a viewer after repeated readiness probes")
