"""ACP stand-in for the self-update end-to-end test.

Streams a numbered `tick` notification every 100 ms, carrying its own pid and
the pid of a background child it started, and answers every request.
"""

import json
import os
import subprocess
import sys
import threading
import time

lock = threading.Lock()
child = subprocess.Popen(["sleep", "3600"])


def send(message):
    with lock:
        sys.stdout.write(json.dumps(message) + "\n")
        sys.stdout.flush()


def tick():
    n = 0
    while True:
        send({
            "jsonrpc": "2.0",
            "method": "tick",
            "params": {"n": n, "pid": os.getpid(), "child": child.pid},
        })
        n += 1
        time.sleep(0.1)


threading.Thread(target=tick, daemon=True).start()
for line in sys.stdin:
    request = json.loads(line)
    if "id" in request and "method" in request:
        send({"jsonrpc": "2.0", "id": request["id"], "result": {}})
