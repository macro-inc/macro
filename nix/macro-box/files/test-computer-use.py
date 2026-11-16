"""Drives the agent's computer-use MCP server as the runtime would.

`test-computer-use.py <servers.json>` starts the `computer-use-linux` entry
over stdio and initializes it. It checks `tools/list`, that the agent's
Chromium is among the windows, that Chromium's AT-SPI tree has its toolbar,
and that a full-screen screenshot is a PNG. Prints the PNG's size.
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


def tool(request_id, name, arguments):
    result = call(request_id, "tools/call", {"name": name, "arguments": arguments})
    if result.get("isError"):
        raise SystemExit(f"{name} failed: {result}")
    return result


def text(result):
    return "\n".join(block["text"] for block in result["content"] if block["type"] == "text")


call(1, "initialize", {
    "protocolVersion": "2025-06-18",
    "capabilities": {},
    "clientInfo": {"name": "macro-box-test", "version": "0"},
})
process.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
tools = {tool["name"] for tool in call(2, "tools/list", {})["tools"]}
for expected in ("screenshot", "get_app_state", "list_windows", "click", "type_text"):
    assert expected in tools, (expected, sorted(tools))

windows = text(tool(3, "list_windows", {}))
assert "chromium" in windows.lower(), windows

state = text(tool(4, "get_app_state", {"app_name_or_bundle_identifier": "Chromium", "interactive_only": True}))
assert "snapshot_id" in state, state[:2000]
# Chromium's toolbar is in the tree only when its accessibility is on.
assert "push button" in state.lower() or "button" in state.lower(), state[:2000]

result = tool(5, "screenshot", {"full_screen": True})
images = [block for block in result["content"] if block["type"] == "image"]
assert images, result
png = base64.b64decode(images[0]["data"])
assert png.startswith(b"\x89PNG"), images[0]["mimeType"]
print(len(png))
process.terminate()
