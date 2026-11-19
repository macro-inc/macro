#!/usr/bin/env python3
"""A stand-in Macro backend on 127.0.0.1:<port>, for the boot-path VM test
and the boot timings on an Incus host (nix/macro-box/AGENTS.md).

Answers the pairing claim with a credential and accepts macrod's runtime
websocket, holding it open; everything else is 404. With a second argument,
a file holding a JSON object, it sends macrod one ApplyAgent with that
object as the agent's environment once the websocket opens, as the service
does for an agent teammate's computer. Logs one line per claim, connection
and message, prefixed with seconds since boot."""
import base64
import hashlib
import json
import socketserver
import sys
import time
from http.server import BaseHTTPRequestHandler

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 41009
APPLY_AGENT = sys.argv[2] if len(sys.argv) > 2 else None
HARNESS = {
    "id": "00000000-0000-0000-0000-0000000000a1",
    "kind": "macrod",
    "name": "probe",
    "owner": {"type": "user", "user_id": "macro|probe@example.com"},
    "created_by": "macro|probe@example.com",
    "created_at": "2026-11-17T00:00:00Z",
    "updated_at": "2026-11-17T00:00:00Z",
    "connected": False,
    "last_connected_at": None,
}


def log(message):
    print(f"{time.clock_gettime(time.CLOCK_BOOTTIME):.3f} {message}", file=sys.stderr, flush=True)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def do_POST(self):
        length = int(self.headers.get("content-length") or 0)
        self.rfile.read(length)
        if self.path.endswith("/claim"):
            log(f"claim {self.path}")
            body = json.dumps({"harness": HARNESS, "token": "mhns_probe"}).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.not_found()

    def do_GET(self):
        if self.path.endswith("/runtime/ws") and self.headers.get("upgrade", "").lower() == "websocket":
            log(f"runtime ws {self.path}")
            key = self.headers["sec-websocket-key"]
            accept = base64.b64encode(
                hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()
            ).decode()
            self.send_response(101)
            self.send_header("upgrade", "websocket")
            self.send_header("connection", "Upgrade")
            self.send_header("sec-websocket-accept", accept)
            self.end_headers()
            self.wfile.flush()
            if APPLY_AGENT:
                with open(APPLY_AGENT) as file:
                    environment = json.load(file)
                self.send_text(json.dumps({"type": "applyAgent", "environment": environment}))
                log("sent applyAgent")
            # Hold the connection; discard whatever macrod sends.
            while self.connection.recv(65536):
                pass
            self.close_connection = True
            return
        self.not_found()

    def send_text(self, text):
        """One unmasked websocket text frame, as a server sends it."""
        payload = text.encode()
        if len(payload) < 126:
            header = bytes([0x81, len(payload)])
        else:
            header = bytes([0x81, 126]) + len(payload).to_bytes(2, "big")
        self.wfile.write(header + payload)
        self.wfile.flush()

    def not_found(self):
        self.send_response(404)
        self.send_header("content-length", "0")
        self.end_headers()


class Server(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


log("listening")
Server(("127.0.0.1", PORT), Handler).serve_forever()
