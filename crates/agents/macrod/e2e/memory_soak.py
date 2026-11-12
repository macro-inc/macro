"""Memory soak of the macrod control panel on Linux.

Runs `macrod` (the panel) in a pseudo-terminal against a fake storage
service, samples its resident memory for MINUTES, and fails when it is still
growing after the first third. The panel re-reads the dashboard every 3 s for
as long as it is open, so memory a refresh leaves behind adds up within
minutes here and to gigabytes over days for an operator.

Run it against the static musl build releases ship (`just build-static`): its
allocator is not a glibc dev build's, and growth that comes from allocator
behaviour shows only in the build that has it.

    python3 memory_soak.py --binary PATH [--minutes 10] [--max-growth-mb 2]
"""

import argparse
import fcntl
import http.server
import json
import os
import pty
import shutil
import struct
import tempfile
import termios
import threading
import time

HARNESS_ID = "00000000-0000-0000-0000-0000005a0a4e"
BOT_ID = "00000000-0000-0000-0000-0000005a0b07"
NOW = "2026-11-09T00:00:00Z"
HARNESS = {
    "allow_permission_bypass": False,
    "id": HARNESS_ID,
    "kind": "macrod",
    "name": "soak",
    "owner": {"type": "user", "user_id": "macro|soak@example.com"},
    "created_by": "macro|soak@example.com",
    "created_at": NOW,
    "updated_at": NOW,
    "connected": True,
    "last_connected_at": NOW,
}
AGENTS = [{"bot_id": BOT_ID, "name": "Soak", "handle": "soak"}]
SESSIONS = [
    {
        "session_id": f"00000000-0000-0000-0000-{n:012d}",
        "bot_id": BOT_ID,
        "bot_name": "Soak",
        "bot_handle": "soak",
        "name": f"Session {n}",
        "status": "active",
        "model": "model",
        "owner_id": "macro|soak@example.com",
        "created_at": NOW,
        "modified_at": NOW,
    }
    for n in range(50)
]
SAMPLE_EVERY = 10
MIN_SAMPLES = 6


class Storage(http.server.BaseHTTPRequestHandler):
    """The harness self endpoints the panel reads, and an idle event stream.

    Anything else, the runtime gateway included, is a 404: the panel keeps
    refreshing while the daemon retries its dial.
    """

    protocol_version = "HTTP/1.1"
    reads = 0

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/webhook/events/stream":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            try:
                while True:
                    self.wfile.write(b": keep-alive\n\n")
                    self.wfile.flush()
                    time.sleep(5)
            except OSError:
                return
        body = {
            "/harnesses/me": HARNESS,
            "/harnesses/me/agents": AGENTS,
            "/harnesses/me/sessions": SESSIONS,
        }.get(path)
        if body is None:
            self.send_error(404)
            return
        Storage.reads += 1
        payload = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


def resident_kb(pid):
    # An exited child is a zombie (status without VmRSS) until reaped, then gone.
    try:
        with open(f"/proc/{pid}/status") as status:
            for line in status:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1])
    except FileNotFoundError:
        pass
    raise AssertionError(f"macrod {pid} exited before the soak finished")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", required=True)
    parser.add_argument("--minutes", type=float, default=10)
    parser.add_argument("--max-growth-mb", type=float, default=2)
    args = parser.parse_args()
    binary = os.path.abspath(args.binary)

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Storage)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"

    work = tempfile.mkdtemp(prefix="macrod-soak-")
    home = os.path.join(work, "home")
    workspace = os.path.join(work, "workspace")
    os.makedirs(workspace)
    os.makedirs(os.path.join(home, ".macrod"))
    with open(os.path.join(home, ".macrod", "macrod.toml"), "w") as config:
        config.write(f"""
[macro]
api_url = "{base}"
storage_url = "{base}"
web_url = "{base}"

[credentials]
harness_id = "{HARNESS_ID}"
token = "mhns_soak"

[harness]
command = "true"

[workspace]
path = "{workspace}"

[update]
auto = false
""")
    # No herdr variables: the panel runs plain, whatever terminal runs this.
    env = {
        "HOME": home,
        "PATH": os.environ["PATH"],
        "TERM": "xterm-256color",
        "MACROD_NO_UPDATE": "1",
    }

    pid, terminal = pty.fork()
    if pid == 0:
        os.chdir(workspace)
        os.execve(binary, [binary], env)
    fcntl.ioctl(terminal, termios.TIOCSWINSZ, struct.pack("HHHH", 50, 160, 0, 0))

    def drain():
        # The panel blocks on a full terminal; read and drop what it draws.
        while True:
            try:
                if not os.read(terminal, 65536):
                    return
            except OSError:
                return

    threading.Thread(target=drain, daemon=True).start()
    samples = []
    try:
        started = time.monotonic()
        while time.monotonic() - started < args.minutes * 60:
            samples.append((time.monotonic() - started, resident_kb(pid)))
            print(f"   {samples[-1][0]:6.0f}s  {samples[-1][1] / 1024:7.1f} MB", flush=True)
            time.sleep(SAMPLE_EVERY)
        assert len(samples) >= MIN_SAMPLES, (
            f"only {len(samples)} samples, too few to measure growth; raise --minutes"
        )
        settled = samples[len(samples) // 3][1]
        growth_mb = (samples[-1][1] - settled) / 1024
        late_minutes = (samples[-1][0] - samples[len(samples) // 3][0]) / 60
        print(
            f"{Storage.reads} dashboard reads; resident memory grew {growth_mb:.1f} MB "
            f"over the last {late_minutes:.1f} minutes",
            flush=True,
        )
        assert Storage.reads > 0, "the panel never read the dashboard"
        assert growth_mb <= args.max_growth_mb, (
            f"macrod grew {growth_mb:.1f} MB after warming up (limit {args.max_growth_mb} MB)"
        )
    finally:
        try:
            os.kill(pid, 15)
        except ProcessLookupError:
            pass
        os.waitpid(pid, 0)
        server.shutdown()
        shutil.rmtree(work, ignore_errors=True)
    print("memory stayed flat")


if __name__ == "__main__":
    main()
