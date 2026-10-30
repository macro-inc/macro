"""ACP stand-in that streams numbered notifications and answers `echo`."""

import json
import os
import sys
import threading
import time

lock = threading.Lock()


def send(message):
    with lock:
        sys.stdout.write(json.dumps(message) + "\n")
        sys.stdout.flush()


def tick():
    n = 0
    while True:
        send({"jsonrpc": "2.0", "method": "tick", "params": {"n": n, "pid": os.getpid()}})
        n += 1
        time.sleep(0.005)


threading.Thread(target=tick, daemon=True).start()
for line in sys.stdin:
    request = json.loads(line)
    send({"jsonrpc": "2.0", "id": request["id"], "result": {"echo": request["method"], "pid": os.getpid()}})
