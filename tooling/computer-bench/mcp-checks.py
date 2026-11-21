#!/usr/bin/env python3
"""Check the user's Claude MCP connection and exercise its configured browser server."""

import argparse
import asyncio
import json
import os
import re
from pathlib import Path
import subprocess
import sys


class McpSession:
    def __init__(self, process: asyncio.subprocess.Process) -> None:
        self.process = process
        self.request_id = 0

    async def send(self, message: dict) -> None:
        if self.process.stdin is None:
            raise RuntimeError("MCP connector has no stdin")
        self.process.stdin.write((json.dumps(message) + "\n").encode())
        await self.process.stdin.drain()

    async def request(self, method: str, params: dict) -> dict:
        self.request_id += 1
        request_id = self.request_id
        await self.send({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})
        if self.process.stdout is None:
            raise RuntimeError("MCP connector has no stdout")
        while line := await self.process.stdout.readline():
            response = json.loads(line)
            if response.get("id") != request_id:
                continue
            if "error" in response:
                raise RuntimeError(f"{method}: {response['error']}")
            result = response.get("result")
            if not isinstance(result, dict):
                raise RuntimeError(f"{method}: missing result object")
            return result
        raise RuntimeError(f"MCP connector closed before {method} answered")

    async def call(self, name: str, arguments: dict) -> dict:
        result = await self.request("tools/call", {"name": name, "arguments": arguments})
        if result.get("isError"):
            raise RuntimeError(f"{name}: tool returned an error: {result.get('content')}")
        return result


async def check_browser(server: dict, args: argparse.Namespace) -> dict:
    command = server.get("command")
    arguments = server.get("args", [])
    environment = server.get("env", {})
    if server.get("type", "stdio") != "stdio" or not isinstance(command, str):
        raise RuntimeError("chrome-devtools must be a configured stdio server")
    if not isinstance(arguments, list) or not all(isinstance(arg, str) for arg in arguments):
        raise RuntimeError("MCP connector args must be strings")
    if not isinstance(environment, dict) or not all(
        isinstance(key, str) and isinstance(value, str) for key, value in environment.items()
    ):
        raise RuntimeError("MCP connector environment must contain strings")

    with (args.log_dir / "mcp-connector.stderr.log").open("wb") as stderr:
        process = await asyncio.create_subprocess_exec(
            command,
            *arguments,
            env={**os.environ, **environment},
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=stderr,
            limit=4 * 1024 * 1024,
        )
        try:
            async with asyncio.timeout(args.timeout):
                session = McpSession(process)
                initialized = await session.request(
                    "initialize",
                    {
                        "protocolVersion": "2025-06-18",
                        "capabilities": {},
                        "clientInfo": {"name": "computer-bench", "version": "1"},
                    },
                )
                await session.send({"jsonrpc": "2.0", "method": "notifications/initialized"})
                tools = []
                definitions = []
                params = {}
                while True:
                    result = await session.request("tools/list", params)
                    definitions.extend(result.get("tools", []))
                    tools.extend(tool["name"] for tool in result.get("tools", []))
                    if not result.get("nextCursor"):
                        break
                    params = {"cursor": result["nextCursor"]}
                (args.log_dir / "mcp-tools.json").write_text(json.dumps(definitions) + "\n")
                if not {"list_pages", "navigate_page", "take_snapshot"}.issubset(tools):
                    raise RuntimeError(f"Required browser tools missing: {tools}")
                pages = await session.call("list_pages", {})
                (args.log_dir / "mcp-pages.json").write_text(json.dumps(pages) + "\n")
                page_text = "\n".join(item.get("text", "") for item in pages.get("content", []))
                page = re.search(r"(?m)^(\d+): ", page_text)
                if page is None:
                    raise RuntimeError("MCP list_pages did not return a browser page ID")
                page_id = int(page[1])
                await session.call("navigate_page", {"pageId": page_id, "type": "url", "url": args.url})
                snapshot = await session.call("take_snapshot", {"pageId": page_id})
                (args.log_dir / "mcp-snapshot.json").write_text(json.dumps(snapshot) + "\n")
                text = "\n".join(item.get("text", "") for item in snapshot.get("content", []))
                if args.expected_text not in text:
                    raise RuntimeError("MCP browser snapshot does not contain expected page text")
                return {
                    "server": "chrome-devtools",
                    "server_info": initialized.get("serverInfo"),
                    "tools": tools,
                    "url": args.url,
                    "page_id": page_id,
                    "snapshot_matches": True,
                }
        finally:
            if process.returncode is None:
                process.terminate()
            try:
                await asyncio.wait_for(process.wait(), timeout=5)
            except TimeoutError:
                process.kill()
                await process.wait()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--claude", default="claude", help="Claude executable on the guest PATH")
    parser.add_argument("--config", type=Path, default=Path.home() / ".claude.json")
    parser.add_argument("--log-dir", type=Path, required=True)
    parser.add_argument("--url", default="https://example.com/")
    parser.add_argument("--expected-text", default="Example Domain")
    parser.add_argument("--timeout", type=float, default=90)
    args = parser.parse_args()
    args.log_dir.mkdir(parents=True, exist_ok=True)
    try:
        config = json.loads(args.config.read_text())
        server = config["mcpServers"]["chrome-devtools"]
        # Use the real user's CLI/config, not a synthetic MCP registration. This
        # health check requires no model request or model credentials.
        health = subprocess.run(
            [args.claude, "mcp", "list"],
            text=True,
            capture_output=True,
            timeout=args.timeout,
            check=True,
        )
        output = health.stdout + health.stderr
        (args.log_dir / "mcp-claude-list.log").write_text(output)
        if not any("chrome-devtools:" in line and "Connected" in line for line in output.splitlines()):
            raise RuntimeError("Claude CLI does not report chrome-devtools Connected")
        result = asyncio.run(check_browser(server, args))
        print(json.dumps({"ok": True, "claude_connected": True, **result}))
        return 0
    except (OSError, ValueError, KeyError, RuntimeError, TimeoutError, subprocess.SubprocessError) as error:
        print(json.dumps({"ok": False, "error": str(error)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
