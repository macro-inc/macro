"""Exercise discovery and browser-action failure handling across real stdio pipes."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SERVER = """#!/usr/bin/env python3
import json
from pathlib import Path
import sys
fault = Path(__file__).with_name("fault").read_text()
if sys.argv[1:] == ["mcp", "list"]:
    print("chrome-devtools: test connector - " + ("Failed" if fault == "disconnected" else "Connected"))
    sys.exit(0)
for line in sys.stdin:
    request = json.loads(line)
    if "id" not in request:
        continue
    method = request["method"]
    if method == "initialize":
        result = {"serverInfo": {"name": "fake-browser"}}
    elif method == "tools/list":
        names = ["take_snapshot"] if fault == "missing-tool" else ["list_pages", "navigate_page", "take_snapshot"]
        result = {"tools": [{"name": name} for name in names]}
    elif method == "tools/call":
        name = request["params"]["name"]
        if name == "list_pages":
            result = {"content": [{"type": "text", "text": "## Pages\\n7: about:blank [selected]"}]}
        elif name == "navigate_page":
            assert request["params"]["arguments"]["pageId"] == 7
            assert request["params"]["arguments"]["url"] == "https://example.com/"
            result = {"isError": fault == "action-error", "content": []}
        else:
            assert request["params"]["arguments"]["pageId"] == 7
            result = {"content": [{"type": "text", "text": "Example Domain"}]}
    print(json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": result}), flush=True)
"""


class McpChecksTest(unittest.TestCase):
    def run_probe(self, fault: str) -> tuple[subprocess.CompletedProcess, dict]:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            server = root / "server.py"
            server.write_text(SERVER)
            server.chmod(0o755)
            (root / "fault").write_text(fault)
            config = root / "config.json"
            config.write_text(
                json.dumps(
                    {
                        "mcpServers": {
                            "chrome-devtools": {
                                "type": "stdio",
                                "command": str(server),
                                "args": [],
                            }
                        }
                    }
                )
            )
            result = subprocess.run(
                [
                    sys.executable,
                    str(Path(__file__).with_name("mcp-checks.py")),
                    "--claude",
                    str(server),
                    "--config",
                    str(config),
                    "--log-dir",
                    str(root / "logs"),
                    "--timeout",
                    "5",
                ],
                capture_output=True,
                text=True,
                timeout=15,
            )
            return result, json.loads(result.stdout)

    def test_connected_session_discovers_and_calls_browser_tools(self) -> None:
        process, result = self.run_probe("")
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertTrue(result["ok"])
        self.assertTrue(result["snapshot_matches"])

    def test_cli_connection_failure_cannot_pass_from_config_alone(self) -> None:
        process, result = self.run_probe("disconnected")
        self.assertEqual(process.returncode, 1)
        self.assertFalse(result["ok"])
        self.assertIn("does not report", result["error"])

    def test_missing_browser_tool_fails_discovery(self) -> None:
        process, result = self.run_probe("missing-tool")
        self.assertEqual(process.returncode, 1)
        self.assertIn("Required browser tools missing", result["error"])

    def test_failed_browser_action_cannot_pass_from_discovery_alone(self) -> None:
        process, result = self.run_probe("action-error")
        self.assertEqual(process.returncode, 1)
        self.assertIn("tool returned an error", result["error"])


if __name__ == "__main__":
    unittest.main()
