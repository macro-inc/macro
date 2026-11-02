"""End-to-end test of macrod's self-update on Linux and macOS.

Installs release v1 of macrod with install.sh from a local mirror, runs it in
a pseudo-terminal against a fake runtime gateway with a stand-in ACP agent,
publishes v2 to the mirror, and checks that macrod replaced itself in place:
same macrod pid, same agent pid, the agent's background child alive, and no
gap in the agent's numbered frames across the two gateway connections.

Two more update cases cover macrod's half of the gap between the old image
closing its gateway socket and the new one dialing: `prompt-in-gap` sends a
prompt on the closing socket after macrod has said it is disconnecting and
checks it is answered exactly once, on the new connection; `output-in-gap`
checks agent output written while no socket is up reaches the gateway. The
fake gateway accepts any frame on any connection; the real harness service
keys request ids and sessions per connection, so these show macrod loses
nothing, not that the service keeps a session across the reconnect.

Negative cases run the same way and check that macrod keeps running v1:
`bad-checksum`, `failing-smoke-test`, `opt-out` and `opt-out-config`.

    python3 update_e2e.py --releases DIR --v1 TAG --v2 TAG [--case NAME]

DIR holds macrod-<tag>-<os>-<arch>.tar.gz (+ .sha256) for both tags, as the
release workflow publishes them.
"""

import argparse
import base64
import hashlib
import http.server
import io
import json
import os
import platform
import pty
import re
import fcntl
import termios
import shutil
import socket
import socketserver
import struct
import subprocess
import sys
import tarfile
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
INSTALLER = os.path.join(HERE, "..", "install", "install.sh")
AGENT = os.path.join(HERE, "stand_in_agent.py")


def platform_slug():
    system = {"Linux": "linux", "Darwin": "macos"}[platform.system()]
    machine = platform.machine().lower()
    arch = {"x86_64": "x86_64", "amd64": "x86_64", "arm64": "aarch64", "aarch64": "aarch64"}[machine]
    return f"{system}-{arch}"


# ---------------------------------------------------------------- the mirror


class Mirror:
    """A release mirror directory served over HTTP."""

    def __init__(self, releases, root):
        self.releases = releases
        self.root = root
        handler = lambda *args: http.server.SimpleHTTPRequestHandler(*args, directory=root)
        http.server.SimpleHTTPRequestHandler.log_message = lambda *args: None
        self.server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def archive_name(self, tag):
        return f"macrod-{tag}-{platform_slug()}.tar.gz"

    def publish(self, tag, archive=None, checksum=None):
        """Make `tag` the latest release, from the built archive or a given one."""
        name = self.archive_name(tag)
        data = archive if archive is not None else open(os.path.join(self.releases, name), "rb").read()
        with open(os.path.join(self.root, name), "wb") as out:
            out.write(data)
        digest = checksum or hashlib.sha256(data).hexdigest()
        with open(os.path.join(self.root, name + ".sha256"), "w") as out:
            out.write(f"{digest}  {name}\n")
        with open(os.path.join(self.root, "latest.json.tmp"), "w") as out:
            json.dump({"tag_name": tag, "assets": []}, out)
        os.replace(os.path.join(self.root, "latest.json.tmp"), os.path.join(self.root, "latest.json"))


def broken_archive():
    """A release archive whose macrod cannot even print its version."""
    script = b"#!/bin/sh\nexit 1\n"
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        info = tarfile.TarInfo("macrod")
        info.size = len(script)
        info.mode = 0o755
        archive.addfile(info, io.BytesIO(script))
    return buffer.getvalue()


# ---------------------------------------------------------- the fake backend


class Gateway:
    """The runtime gateway: accepts macrod's WebSocket and records ticks.

    With `prompt_on_disconnect`, it answers macrod's `disconnected` event by
    sending a `session/prompt` on that same, closing socket.
    """

    PROMPT_ID = "prompt-in-gap"

    def __init__(self, prompt_on_disconnect=False):
        self.prompt_on_disconnect = prompt_on_disconnect
        self.disconnected_at = {}  # connection -> wall-clock time
        self.opened_at = {}  # connection -> wall-clock time
        self.responses = []  # (connection, id)
        self.listener = socket.socket()
        self.listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen()
        self.port = self.listener.getsockname()[1]
        self.connections = 0
        self.ticks = []  # (connection, n, pid, child)
        self.lock = threading.Lock()
        threading.Thread(target=self.accept, daemon=True).start()

    def accept(self):
        while True:
            conn, _ = self.listener.accept()
            threading.Thread(target=self.serve, args=(conn,), daemon=True).start()

    def serve(self, conn):
        request = b""
        while b"\r\n\r\n" not in request:
            chunk = conn.recv(4096)
            if not chunk:
                return
            request += chunk
        head, rest = request.split(b"\r\n\r\n", 1)
        headers = {
            name.lower(): value
            for name, value in (
                line.split(": ", 1) for line in head.decode().split("\r\n")[1:] if ": " in line
            )
        }
        if "/runtime/ws" not in head.split(b"\r\n")[0].decode():
            # Any other API call: an empty answer.
            conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n[]")
            conn.close()
            return
        key = headers["sec-websocket-key"]
        accept = base64.b64encode(
            hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()
        ).decode()
        conn.sendall(
            "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept}\r\n\r\n".encode()
        )
        with self.lock:
            self.connections += 1
            number = self.connections
            self.opened_at[number] = time.time()
        reader = conn.makefile("rb")
        buffered = io.BytesIO(rest)

        def read(count):
            data = buffered.read(count)
            while len(data) < count:
                more = reader.read(count - len(data))
                if not more:
                    raise EOFError
                data += more
            return data

        try:
            while True:
                first, second = read(2)
                opcode = first & 0x0F
                length = second & 0x7F
                if length == 126:
                    (length,) = struct.unpack(">H", read(2))
                elif length == 127:
                    (length,) = struct.unpack(">Q", read(8))
                mask = read(4) if second & 0x80 else b"\0\0\0\0"
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(read(length)))
                if opcode == 0x8:
                    return
                if opcode == 0x9:
                    conn.sendall(bytes([0x8A, len(payload)]) + payload)
                    continue
                if opcode != 0x1:
                    continue
                message = json.loads(payload)
                if message.get("type") == "acp" and message.get("method") == "tick":
                    params = message["params"]
                    with self.lock:
                        self.ticks.append((number, params["n"], params["pid"], params["child"], params["t"]))
                elif message.get("type") == "acp" and "id" in message and "method" not in message:
                    with self.lock:
                        self.responses.append((number, message["id"]))
                elif message.get("type") == "event" and message.get("event") == "disconnected":
                    with self.lock:
                        self.disconnected_at[number] = time.time()
                    if self.prompt_on_disconnect and number == 1:
                        send_text(conn, {
                            "type": "acp", "jsonrpc": "2.0", "id": self.PROMPT_ID,
                            "method": "session/prompt",
                            "params": {"sessionId": "s", "prompt": [{"type": "text", "text": "hi"}]},
                        })
        except (EOFError, OSError, ValueError):
            return
        finally:
            conn.close()

    def gap_record(self):
        with self.lock:
            return dict(self.disconnected_at), dict(self.opened_at), list(self.responses)

    def snapshot(self):
        with self.lock:
            return self.connections, list(self.ticks)


def send_text(conn, message):
    """One unmasked server-to-client WebSocket text frame."""
    payload = json.dumps(message).encode()
    if len(payload) < 126:
        header = bytes([0x81, len(payload)])
    else:
        header = bytes([0x81, 126]) + struct.pack(">H", len(payload))
    conn.sendall(header + payload)


# ------------------------------------------------------------------- helpers


def wait_for(description, condition, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if condition():
            return
        time.sleep(0.2)
    raise AssertionError(f"timed out waiting for {description}")


def alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


def installed_version(binary):
    return subprocess.run([binary, "--version"], capture_output=True, text=True, check=True).stdout.split()[-1]


def update_log(home):
    """The events in macrod's update log, without their timestamps."""
    path = os.path.join(home, ".macrod", "logs", "update.log")
    assert os.stat(path).st_mode & 0o777 == 0o600, "the update log is private"
    events = []
    with open(path) as log:
        for line in log:
            event = json.loads(line)
            assert event.pop("time"), "every line is timestamped"
            events.append(event)
    return events


def assert_in_order(events, expected):
    """Each expected event appears, in this order, with these fields."""
    position = 0
    for want in expected:
        while position < len(events) and any(events[position].get(k) != v for k, v in want.items()):
            position += 1
        assert position < len(events), f"missing {want} in order; log: {events}"
        position += 1


def run_case(case, releases, v1, v2):
    print(f"== {case}", flush=True)
    work = tempfile.mkdtemp(prefix="macrod-e2e-")
    home = os.path.join(work, "home")
    os.makedirs(home)
    mirror_root = os.path.join(work, "mirror")
    os.makedirs(mirror_root)
    mirror = Mirror(releases, mirror_root)
    mirror.publish(v1)

    env = {
        "HOME": home,
        "PATH": os.environ["PATH"],
        "SHELL": "/bin/bash",
        "TERM": "xterm-256color",
        "MACROD_UPDATE_SOURCE": mirror.url,
        "MACROD_UPDATE_CHECK_SECONDS": "1",
        "RUST_LOG": "info",
    }
    subprocess.run(["sh", INSTALLER], env=env, check=True)
    binary = os.path.join(home, ".local", "bin", "macrod")
    assert installed_version(binary) == v1, "install.sh installs the latest release"

    gateway = Gateway(prompt_on_disconnect=case == "prompt-in-gap")
    base = f"http://127.0.0.1:{gateway.port}"
    workspace = os.path.join(work, "workspace")
    os.makedirs(workspace)
    with open(os.path.join(workspace, "macrod.toml"), "w") as config:
        config.write(f"""
[macro]
api_url = "{base}"
storage_url = "{base}"
web_url = "{base}"

[credentials]
harness_id = "00000000-0000-0000-0000-0000004a125a"
token = "mhns_e2e"
scope = "user"

[harness]
command = "{sys.executable}"
args = ["{AGENT}"]

[workspace]
path = "{workspace}"
""")
        if case == "opt-out-config":
            config.write("\n[update]\nauto = false\n")
    if case == "opt-out":
        env["MACROD_NO_UPDATE"] = "1"

    pid, terminal = pty.fork()
    if pid == 0:
        os.chdir(workspace)
        os.execve(binary, [binary], env)
    # A real terminal size, so the panel lays out and draws.
    fcntl.ioctl(terminal, termios.TIOCSWINSZ, struct.pack("HHHH", 50, 160, 0, 0))
    screen = bytearray()

    def drain():
        while True:
            try:
                data = os.read(terminal, 65536)
            except OSError:
                return
            if not data:
                return
            screen.extend(data)

    threading.Thread(target=drain, daemon=True).start()
    try:
        wait_for("the first connection's ticks", lambda: len(gateway.snapshot()[1]) >= 100, 60)
        _, ticks = gateway.snapshot()
        agent_pid, child_pid = ticks[0][2], ticks[0][3]

        if case in UPDATE_CASES:
            mirror.publish(v2)
            wait_for("the updated macrod's connection", lambda: gateway.snapshot()[0] >= 2, 120)
            wait_for(
                "ticks on the second connection",
                lambda: sum(1 for t in gateway.snapshot()[1] if t[0] == 2) >= 100,
                60,
            )
            connections, ticks = gateway.snapshot()
            numbers = [t[1] for t in ticks]
            assert numbers == list(range(len(numbers))), f"frames lost or repeated: {numbers}"
            assert {t[2] for t in ticks} == {agent_pid}, "one agent process across the update"
            assert alive(agent_pid) and alive(child_pid), "the agent and its child kept running"
            assert alive(pid), "macrod is running"
            assert installed_version(binary) == v2, "the installed binary is v2"
            if platform.system() == "Linux":
                exe = os.readlink(f"/proc/{pid}/exe")
                assert exe == os.path.realpath(binary), f"macrod runs {exe}"
            assert_in_order(
                update_log(home),
                [
                    {"event": "startup", "version": v1, "from_handoff": False},
                    {"event": "check", "current": v1, "latest": v2, "outcome": "newer"},
                    {"event": "download", "version": v2, "checksum_ok": True, "result": "staged"},
                    {"event": "apply", "from": v1, "to": v2, "method": "execve-handoff", "result": "restarting"},
                    {"event": "startup", "version": v2, "from_handoff": True},
                ],
            )
            disconnected_at, opened_at, responses = gateway.gap_record()
            if case == "prompt-in-gap":
                answers = [connection for connection, id in responses if id == Gateway.PROMPT_ID]
                assert answers == [2], f"the prompt sent during the handoff is answered once, on the new socket: {answers}"
                print("   a prompt sent on the closing socket was answered once, on the new one")
            if case == "output-in-gap":
                # From the last frame the old image forwarded to the new
                # socket's handshake, nothing was reading the agent.
                gap = (max(t[4] for t in ticks if t[0] == 1), opened_at[2])
                in_gap = [t for t in ticks if gap[0] < t[4] < gap[1]]
                assert in_gap, f"no output was written during the {gap[1] - gap[0]:.2f}s gap"
                assert {t[0] for t in in_gap} == {2}, "output written in the gap arrives on the new socket"
                assert disconnected_at[1] < opened_at[2], "the old socket said it was disconnecting first"
                print(f"   {len(in_gap)} frames written during the {gap[1] - gap[0]:.2f}s gap all arrived on the new socket")
            print(
                f"   macrod pid {pid} kept, agent pid {agent_pid} kept, child {child_pid} alive, "
                f"{len(numbers)} frames 0..{numbers[-1]} over {connections} connections, now {v2}"
            )
        else:
            if case == "bad-checksum":
                mirror.publish(v2, checksum="0" * 64)
            elif case == "failing-smoke-test":
                mirror.publish(v2, archive=broken_archive())
            else:
                mirror.publish(v2)
            # Several check intervals, each of which would have updated.
            time.sleep(8)
            connections, ticks = gateway.snapshot()
            assert connections == 1, f"macrod reconnected {connections - 1} times"
            assert alive(pid), "macrod is still running"
            assert installed_version(binary) == v1, "the installed binary is still v1"
            assert {t[2] for t in ticks} == {agent_pid}
            leftovers = [name for name in os.listdir(os.path.dirname(binary)) if name.startswith(".macrod")]
            assert not leftovers, f"staging left {leftovers}"
            events = update_log(home)
            assert not [e for e in events if e["event"] == "apply"], f"nothing was applied: {events}"
            if case == "bad-checksum":
                assert_in_order(events, [{"event": "download", "version": v2, "checksum_ok": False}])
            elif case == "failing-smoke-test":
                assert_in_order(events, [{"event": "download", "version": v2, "checksum_ok": True}])
                assert "smoke test" in next(e for e in events if e["event"] == "download")["result"]
            else:
                assert [e["event"] for e in events] == ["startup"], f"updating is off: {events}"
            print(f"   still {v1} after publishing {v2}; {len(ticks)} frames on one connection")
    except BaseException:
        text = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", " ", screen.decode(errors="replace"))
        print("connections/ticks:", gateway.snapshot()[0], len(gateway.snapshot()[1]))
        print(re.sub(r" +", " ", text)[-3000:])
        raise
    finally:
        try:
            os.kill(pid, 15)
        except ProcessLookupError:
            pass
        os.waitpid(pid, 0)
        _, ticks = gateway.snapshot()
        if ticks:
            for leftover in {ticks[0][2], ticks[0][3]}:
                try:
                    os.kill(leftover, 9)
                except ProcessLookupError:
                    pass
        mirror.server.shutdown()
        shutil.rmtree(work, ignore_errors=True)


UPDATE_CASES = ["update", "prompt-in-gap", "output-in-gap"]
NEGATIVE_CASES = ["bad-checksum", "failing-smoke-test", "opt-out", "opt-out-config"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--releases", required=True)
    parser.add_argument("--v1", required=True)
    parser.add_argument("--v2", required=True)
    parser.add_argument(
        "--case",
        action="append",
        choices=UPDATE_CASES + NEGATIVE_CASES,
    )
    args = parser.parse_args()
    for case in args.case or UPDATE_CASES + NEGATIVE_CASES:
        run_case(case, os.path.abspath(args.releases), args.v1, args.v2)
    print("all cases passed")


if __name__ == "__main__":
    main()
