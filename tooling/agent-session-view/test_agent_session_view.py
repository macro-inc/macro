"""Tests for the viewer's exporters: python3 -m unittest discover tooling/agent-session-view"""
import importlib.machinery
import importlib.util
import json
import pathlib
import unittest
import urllib.error
from unittest import mock

import datadog_spans
import markdown_export

HERE = pathlib.Path(__file__).resolve().parent
_loader = importlib.machinery.SourceFileLoader("agent_session_view", str(HERE / "agent-session-view"))
_spec = importlib.util.spec_from_loader("agent_session_view", _loader)
cli = importlib.util.module_from_spec(_spec)
_loader.exec_module(cli)


def frame(t, content):
    return {"t": f"2026-11-09T10:00:{t:06.3f}+00:00", "content": content}


def prompt(t):
    return frame(t, {"method": "session/prompt", "params": {"prompt": [{"type": "text", "text": "go"}]}})


def update(t, **fields):
    return frame(t, {"method": "session/update", "params": {"update": fields}})


def call(t, call_id, name="Search", status="pending"):
    return update(t, sessionUpdate="tool_call", toolCallId=call_id, title=name,
                  _meta={"macro": {"toolName": name}}, rawInput={}, status=status)


def done(t, call_id, raw, status="completed"):
    return update(t, sessionUpdate="tool_call_update", toolCallId=call_id, status=status, rawOutput=raw)


def end(t):
    return frame(t, {"id": 1, "result": {"stopReason": "end_turn"}})


class Exporter(unittest.TestCase):
    def test_a_structured_error_is_one_line_of_json(self):
        turns = markdown_export.parse([
            prompt(0), call(1, "a"), done(2, "a", {"error": {"code": 500, "message": "boom"}}, "failed"), end(3),
        ])
        self.assertEqual(turns[0].steps[0].error, '{"code": 500, "message": "boom"}')

    def test_a_completed_result_carrying_an_error_is_a_failure(self):
        turns = markdown_export.parse([prompt(0), call(1, "a"), done(2, "a", {"error": "denied"}), end(3)])
        self.assertEqual(turns[0].steps[0].error, "denied")

    def test_parallel_tools_count_their_overlap_once(self):
        turns = markdown_export.parse([
            prompt(0), call(1, "a"), call(2, "b"), done(5, "a", {}), done(6, "b", {}), end(7),
        ])
        self.assertAlmostEqual(markdown_export.Totals(turns).tool_time, 5)

    def test_an_unfinished_turn_ends_at_its_last_frame(self):
        export = {
            "session": {"id": "s"},
            "frames": [prompt(0), call(1, "a"), done(2, "a", {}), prompt(10), end(12)],
            "spans": {"tools": {}, "model_calls": [
                {"start_ms": seconds(1) * 1000, "end_ms": seconds(2) * 1000},
                {"start_ms": seconds(11) * 1000, "end_ms": seconds(12) * 1000},
            ]},
        }
        turns = markdown_export.parse(export["frames"])
        self.assertEqual(len(markdown_export.model_calls(export["spans"], turns[0])), 1)
        self.assertAlmostEqual(markdown_export.Totals(turns).wall, 4)

    def test_a_reused_tool_call_id_takes_its_spans_in_order(self):
        spans = {"a": [{"start_ms": seconds(1) * 1000, "end_ms": seconds(2) * 1000},
                       {"start_ms": seconds(4) * 1000, "end_ms": seconds(7) * 1000}]}
        turns = markdown_export.parse(
            [prompt(0), call(1, "a"), done(2, "a", {}), call(4, "a"), done(7, "a", {}), end(8)], spans,
        )
        self.assertEqual([step.duration for step in turns[0].steps], [1, 3])

    def test_a_fence_outlasts_backticks_in_its_content(self):
        self.assertEqual(markdown_export.fence("a\n```\nb"), "````\na\n```\nb\n````")

    def test_code_mode_through_mcp_counts_as_a_code_run(self):
        turns = markdown_export.parse([prompt(0), call(1, "a", "mcp__macro_internal__ExecuteCode"),
                                       done(2, "a", {"status": "timed_out"}), end(3)])
        self.assertEqual(markdown_export.Totals(turns).code_runs, 1)
        self.assertEqual(turns[0].steps[0].error, "timed_out")


class Spans(unittest.TestCase):
    def test_the_unsectioned_prompt_is_kept(self):
        span = {"start_timestamp": "2026-11-09T10:00:00Z", "end_timestamp": "2026-11-09T10:00:01Z",
                "custom": {"macro": {"genai": {"prompt": {"unsectioned": {"bytes": "4000"}}}}}}
        self.assertEqual(datadog_spans.model_call(span)["prompt_bytes"], {"unsectioned": 4000})

    def test_a_rate_limit_is_waited_out(self):
        limited = urllib.error.HTTPError("url", 429, "Too Many Requests", {"X-RateLimit-Reset": "3"}, None)
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = b'{"data": []}'
        with mock.patch("urllib.request.urlopen", side_effect=[limited, response]), \
                mock.patch("time.sleep") as sleep:
            self.assertEqual(datadog_spans.send(mock.Mock()), {"data": []})
        sleep.assert_called_once_with(4)

    def test_other_failures_still_raise(self):
        failed = urllib.error.HTTPError("url", 403, "Forbidden", {}, None)
        with mock.patch("urllib.request.urlopen", side_effect=failed):
            with self.assertRaises(urllib.error.HTTPError):
                datadog_spans.send(mock.Mock())


class Cli(unittest.TestCase):
    def test_the_password_leaves_the_url(self):
        url, password = cli.without_password("postgresql://reader:p%40ss@db:5432/macro?sslmode=require")
        self.assertEqual(url, "postgresql://reader@db:5432/macro?sslmode=require")
        self.assertEqual(password, "p@ss")

    def test_postgres_times_with_trimmed_fractions_parse(self):
        self.assertEqual(cli.postgres_time("2026-11-09T10:00:00.12+00:00").microsecond, 120000)
        self.assertEqual(cli.postgres_time("2026-11-09T10:00:00.1+00").microsecond, 100000)

    def test_session_text_cannot_end_or_change_its_script_element(self):
        text = "</script><!--<script>"
        page = cli.render({"session": {"id": "s", "name": text}, "frames": []})
        payload = page.split('type="application/json">', 1)[1].split("</script>", 1)[0]
        self.assertNotIn("<", payload)
        self.assertEqual(json.loads(payload)["session"]["name"], text)


def seconds(t):
    return markdown_export.seconds(frame(t, {})["t"])


if __name__ == "__main__":
    unittest.main()
