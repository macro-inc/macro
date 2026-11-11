"""ACP stand-in for the self-update end-to-end test.

Streams a numbered `tick` notification every 2 ms, carrying its own pid,
the pid of a background child it started, and the wall-clock time it was
written, and answers every request.
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
            "params": {"n": n, "pid": os.getpid(), "child": child.pid, "t": time.time()},
        })
        n += 1
        # Well under the shortest update handoff, so `output-in-gap` always
        # sees frames written while nothing was reading; at 20 ms a fast
        # handoff could fall between two ticks and fail the test.
        time.sleep(0.002)


threading.Thread(target=tick, daemon=True).start()
for line in sys.stdin:
    request = json.loads(line)
    if "id" in request and "method" in request:
        send({"jsonrpc": "2.0", "id": request["id"], "result": {}})
