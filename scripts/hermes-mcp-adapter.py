#!/usr/bin/env python3
"""Local Hermes MCP adapter for Macro development.

Exposes a minimal Streamable HTTP-style MCP endpoint with two tools:
- hermes_health: confirms the adapter can see the Hermes CLI.
- hermes_ask: invokes `hermes -z <prompt>` non-interactively.

This is intentionally local/Tailscale-first and does not touch the Hermes gateway.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from typing import Any

BIND_HOST = "100.111.156.40"
BIND_PORT = 13444
MAX_PROMPT_CHARS = 8000
DEFAULT_TIMEOUT_SECONDS = 120
MAX_TIMEOUT_SECONDS = 300


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


def json_response(handler: BaseHTTPRequestHandler, status: int, payload: Any) -> None:
    data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Headers", "content-type, authorization, mcp-session-id")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def text_content(text: str, is_error: bool = False) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": text}], "isError": is_error}


def rpc_result(request_id: Any, result: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def rpc_error(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def run_hermes(prompt: str, timeout_seconds: int) -> tuple[bool, str]:
    hermes_bin = shutil.which("hermes")
    if not hermes_bin:
        return False, "Hermes CLI not found on PATH."

    bounded_timeout = max(1, min(timeout_seconds, MAX_TIMEOUT_SECONDS))
    try:
        completed = subprocess.run(
            [hermes_bin, "-z", prompt],
            text=True,
            capture_output=True,
            timeout=bounded_timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return False, f"Hermes timed out after {bounded_timeout}s."

    output = (completed.stdout or "").strip()
    error = (completed.stderr or "").strip()
    if completed.returncode != 0:
        detail = error or output or f"Hermes exited with code {completed.returncode}."
        return False, detail[:4000]
    return True, output[:20000] if output else "Hermes returned no text."


def list_tools() -> dict[str, Any]:
    return {
        "tools": [
            {
                "name": "hermes_health",
                "description": "Check whether the local Hermes CLI adapter is reachable.",
                "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
            },
            {
                "name": "hermes_ask",
                "description": "Ask the local Hermes Agent a prompt via noninteractive `hermes -z`. Does not restart or touch the Hermes gateway.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "prompt": {"type": "string", "description": "Prompt to send to Hermes."},
                        "timeout_seconds": {
                            "type": "integer",
                            "description": "Optional timeout, capped at 300 seconds.",
                            "minimum": 1,
                            "maximum": MAX_TIMEOUT_SECONDS,
                        },
                    },
                    "required": ["prompt"],
                    "additionalProperties": False,
                },
            },
        ]
    }


def handle_rpc(req: dict[str, Any]) -> dict[str, Any] | None:
    method = req.get("method")
    request_id = req.get("id")
    params = req.get("params") or {}

    if request_id is None:
        # JSON-RPC notification. MCP sends notifications/initialized here.
        return None

    if method == "initialize":
        return rpc_result(
            request_id,
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "hermes-agent", "version": "local-dev"},
            },
        )

    if method == "tools/list":
        return rpc_result(request_id, list_tools())

    if method == "tools/call":
        name = params.get("name")
        args = params.get("arguments") or {}
        if name == "hermes_health":
            hermes_bin = shutil.which("hermes")
            status = "ok" if hermes_bin else "missing"
            return rpc_result(request_id, text_content(f"Hermes MCP adapter reachable. hermes_cli={status}"))
        if name == "hermes_ask":
            prompt = str(args.get("prompt") or "").strip()
            if not prompt:
                return rpc_result(request_id, text_content("Missing required argument: prompt", True))
            if len(prompt) > MAX_PROMPT_CHARS:
                return rpc_result(request_id, text_content(f"Prompt exceeds {MAX_PROMPT_CHARS} characters.", True))
            timeout_seconds = int(args.get("timeout_seconds") or DEFAULT_TIMEOUT_SECONDS)
            ok, output = run_hermes(prompt, timeout_seconds)
            return rpc_result(request_id, text_content(output, not ok))
        return rpc_error(request_id, -32602, f"Unknown tool: {name}")

    return rpc_error(request_id, -32601, f"Unsupported method: {method}")


class Handler(BaseHTTPRequestHandler):
    server_version = "HermesMcpAdapter/0.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"{self.client_address[0]} {self.command} {self.path} - {fmt % args}", flush=True)

    def do_OPTIONS(self) -> None:
        json_response(self, 200, {"ok": True})

    def do_GET(self) -> None:
        if self.path in {"/", "/health", "/mcp"}:
            json_response(self, 200, {"ok": True, "name": "hermes-agent", "endpoint": "/mcp"})
            return
        json_response(self, 404, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path.split("?", 1)[0] != "/mcp":
            json_response(self, 404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length") or "0")
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            json_response(self, 400, rpc_error(None, -32700, "Parse error"))
            return

        if isinstance(payload, list):
            responses = [r for r in (handle_rpc(item) for item in payload if isinstance(item, dict)) if r is not None]
            json_response(self, 200, responses)
            return
        if not isinstance(payload, dict):
            json_response(self, 400, rpc_error(None, -32600, "Invalid request"))
            return

        response = handle_rpc(payload)
        if response is None:
            self.send_response(202)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        json_response(self, 200, response)


def main() -> None:
    server = ThreadingHTTPServer((BIND_HOST, BIND_PORT), Handler)
    print(f"Hermes MCP adapter listening on http://{BIND_HOST}:{BIND_PORT}/mcp", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
