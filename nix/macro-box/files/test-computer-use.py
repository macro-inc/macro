"""Drives the agent's computer-use MCP server as the runtime would.

`test-computer-use.py <servers.json>` starts the `computer-use-linux` entry
over stdio, initializes, checks `tools/list` has `screenshot`, then calls it
for the full screen and checks a PNG comes back. Prints the PNG's size.
"""
import base64
import json
import os
import subprocess
import sys

server = json.load(open(sys.argv[1]))["computer-use-linux"]
process = subprocess.Popen(
    [server["command"], *server["args"]],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    env={**os.environ, **server["env"]},
    text=True,
)


def call(request_id, method, params):
    process.stdin.write(json.dumps({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}) + "\n")
    process.stdin.flush()
    while True:
        message = json.loads(process.stdout.readline())
        if message.get("id") == request_id:
            if "error" in message:
                raise SystemExit(f"{method} failed: {message['error']}")
            return message["result"]


call(1, "initialize", {
    "protocolVersion": "2025-06-18",
    "capabilities": {},
    "clientInfo": {"name": "macro-box-test", "version": "0"},
})
process.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
tools = {tool["name"] for tool in call(2, "tools/list", {})["tools"]}
assert "screenshot" in tools, sorted(tools)
result = call(3, "tools/call", {"name": "screenshot", "arguments": {"full_screen": True}})
images = [block for block in result["content"] if block["type"] == "image"]
assert images, result
png = base64.b64decode(images[0]["data"])
assert png.startswith(b"\x89PNG"), images[0]["mimeType"]
print(len(png))
process.terminate()
