# A viewer of the agent screen encoder, for the VM tests: connect to
# 127.0.0.1:<port>, send `<config line>`, write what arrives in <seconds> to
# <output>, then check it is ftyp + moov, then whole moof + mdat pairs.
# Usage: test-screen-encoder-client.py <port> <config line> <seconds> <output>
import socket
import struct
import sys
import time

port, line, seconds, output = int(sys.argv[1]), sys.argv[2], float(sys.argv[3]), sys.argv[4]
data = bytearray()
with socket.create_connection(("127.0.0.1", port), timeout=10) as connection:
    connection.sendall(line.encode() + b"\n")
    deadline = time.monotonic() + seconds
    while (left := deadline - time.monotonic()) > 0:
        connection.settimeout(left)
        try:
            chunk = connection.recv(65536)
        except TimeoutError:
            break
        if not chunk:
            break
        data += chunk

boxes, at, whole = [], 0, 0
while at + 8 <= len(data):
    size, kind = struct.unpack(">I4s", data[at : at + 8])
    if size < 8 or at + size > len(data):
        break  # the last box, cut off when the viewer hung up
    boxes.append(kind.decode())
    at += size
    if kind != b"moof":
        whole = at
assert boxes[:2] == ["ftyp", "moov"], boxes[:4]
fragments = boxes[2:]
if fragments and fragments[-1] == "moof":
    fragments.pop()  # its mdat was cut off
assert fragments and fragments == ["moof", "mdat"] * (len(fragments) // 2), fragments[:8]
# Up to the last whole fragment, so ffprobe reads every one.
with open(output, "wb") as file:
    file.write(data[:whole])
print(f"{len(fragments) // 2} fragments")
