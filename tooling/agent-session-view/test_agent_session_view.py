"""Tests for the viewer's exporters: python3 -m unittest discover tooling/agent-session-view"""
import http.server
import importlib.machinery
import importlib.util
import json
import pathlib
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from unittest import mock

import datadog_spans
import markdown_export
import turn_context

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


class DocumentationAndTools(unittest.TestCase):
    def test_a_documentation_selection_reads_its_entities_and_bytes(self):
        span = {"trace_id": "t1", "start_timestamp": "2026-11-09T10:00:00Z",
                "custom": {"selection_status": "selected", "selected": "2", "selected_entities": "channels,users",
                           "bytes": "20111", "guidance": "Inline", "batches": "2"}}
        self.assertEqual(datadog_spans.documentation(span), {
            "trace_id": "t1", "start_ms": 1794218400000.0, "status": "selected", "selected": 2,
            "entities": ["channels", "users"], "bytes": 20111, "guidance": "Inline", "batches": 2,
        })

    def test_a_cut_tool_listing_keeps_every_whole_name_and_no_descriptions(self):
        definitions = ('[{"type":"function","name":"ExecuteCode","description":"Run \\"name\\":\\"x\\""},'
                       '{"type":"function","name":"mcp__GitHub__get_me","description":"Who'
                       '{"type":"function","name":"ExecuteCode","descr')
        span = {"start_timestamp": "2026-11-09T10:00:00Z", "end_timestamp": "2026-11-09T10:00:09Z",
                "custom": {"gen_ai": {"tool": {"definitions": definitions}},
                           "macro": {"genai": {"content_truncated": "true"}}}}
        offer = datadog_spans.tool_offer(span)
        self.assertEqual(offer["names"], ["ExecuteCode", "mcp__GitHub__get_me"])
        self.assertTrue(offer["cut"])

    def test_a_whole_tool_listing_is_not_cut_whatever_the_span_says(self):
        span = {"start_timestamp": "2026-11-09T10:00:00Z", "end_timestamp": "2026-11-09T10:00:09Z",
                "custom": {"gen_ai": {"tool": {"definitions": '[{"type":"function","name":"ExecuteCode"}]'}},
                           "macro": {"genai": {"content_truncated": "true"}}}}
        self.assertFalse(datadog_spans.tool_offer(span)["cut"])

    def test_the_eager_lists_are_read_from_the_source(self):
        names = turn_context.eager_names_from_source()
        self.assertIn("SearchTools", names)
        self.assertIn("DescribeCodeTools", names)

    def test_an_unreadable_eager_list_is_unknown_not_guessed(self):
        self.assertIsNone(turn_context.eager_names_from_source(pathlib.Path("/nonexistent")))


def tool_result(t, call_id, name, raw):
    return [call(t, call_id, name), done(t + 0.5, call_id, raw)]


def code_failure(t, call_id, message):
    return [call(t, call_id, "mcp__macro_internal__ExecuteCode"),
            done(t + 0.5, call_id, {"status": "failed", "error": message})]


def spans_for_turn(selected):
    return {
        "tools": {},
        "model_calls": [
            {"start_ms": seconds(0.5) * 1000, "end_ms": seconds(1) * 1000, "eager_tools": 0, "prompt_bytes": {}},
            {"start_ms": seconds(1) * 1000, "end_ms": seconds(2) * 1000, "eager_tools": 4, "loaded_tools": 1,
             "input_tokens": 900, "prompt_bytes": {"sdk_docs": 8068, "tools.eager": 7000, "history": 300}},
        ],
        "documentation": [{"start_ms": seconds(0.2) * 1000, "status": "selected", "selected": selected,
                           "entities": [], "bytes": 8055, "guidance": "Inline", "batches": 2}],
        "tool_offers": [{"start_ms": seconds(0) * 1000, "end_ms": seconds(30) * 1000, "cut": False,
                         "names": ["ExecuteCode", "DescribeCodeTools", "ReadCodeDocs", "mcp__GitHub__get_me",
                                   "mcp__GitHub__search_code"]}],
    }


class TurnContext(unittest.TestCase):
    def test_the_acceptance_shape_raises_both_flags(self):
        export = {"session": {"id": "s"}, "spans": spans_for_turn(0), "frames": [
            prompt(0),
            *tool_result(1, "s1", "SearchTools", {"results": [{"name": "mcp__GitHub__search_code"}],
                                                  "additional_matches": [{"name": "mcp__GitHub__get_me"}]}),
            *code_failure(2, "c1", "TypeError: msg.sender is not a function"),
            *code_failure(3, "c2", "TypeError: macro.users.byEmail is not a function"),
            *code_failure(4, "c3", "TypeError: channel.members(...) is not a function or its return value "
                                   "is not async iterable"),
            end(5),
        ]}
        source = ["SearchTools", "LoadTools", "ExecuteCode", "DescribeCodeTools", "ReadCodeDocs", "PresentReview"]
        context = turn_context.for_session(export, source)[0]
        self.assertEqual(context["tools"]["eager"]["names"],
                         ["SearchTools", "ExecuteCode", "DescribeCodeTools", "ReadCodeDocs"])
        self.assertEqual(context["tools"]["loaded"],
                         [{"name": "mcp__GitHub__search_code", "step": 1, "tool": 1, "via": "SearchTools"}])
        self.assertEqual(context["tools"]["deferred"], ["mcp__GitHub__get_me"])
        self.assertEqual([found["id"] for found in context["flags"]],
                         ["no-sdk-index", "guessed-sdk-methods", "failing-code"])
        self.assertEqual(context["flags"][1]["tools"], [2, 3, 4])

    def test_describing_the_sdk_clears_the_guessed_methods_flag(self):
        export = {"session": {"id": "s"}, "spans": spans_for_turn(2), "frames": [
            prompt(0),
            *tool_result(1, "d1", "mcp__macro_internal__DescribeCodeTools", {"index": "…"}),
            *code_failure(2, "c1", "TypeError: msg.sender is not a function"),
            end(3),
        ]}
        source = ["ExecuteCode", "DescribeCodeTools", "ReadCodeDocs", "SearchTools"]
        flags = [found["id"] for found in turn_context.for_session(export, source)[0]["flags"]]
        self.assertEqual(flags, [])

    def test_more_eager_names_than_the_span_counts_is_flagged(self):
        export = {"session": {"id": "s"}, "spans": spans_for_turn(2), "frames": [
            prompt(0), *tool_result(1, "s1", "SearchTools", {"results": [], "already_available": ["NameSearch"]}),
            end(2),
        ]}
        source = ["ExecuteCode", "DescribeCodeTools", "ReadCodeDocs", "SearchTools", "NameSearch"]
        flags = [found["id"] for found in turn_context.for_session(export, source)[0]["flags"]]
        self.assertEqual(flags, ["eager-names-exceed-span"])

    def test_unknown_eager_names_are_a_loud_flag(self):
        export = {"session": {"id": "s"}, "spans": spans_for_turn(2), "frames": [prompt(0), end(1)]}
        context = turn_context.for_session(export, None)[0]
        self.assertIsNone(context["tools"]["eager"]["names"])
        self.assertEqual(context["flags"][0]["id"], "eager-names-unknown")
        self.assertEqual(context["flags"][0]["level"], "warn")

    def test_the_same_failure_three_times_is_flagged(self):
        frames = [prompt(0)]
        for number in range(3):
            frames += [call(1 + number, f"b{number}", "BashCodeExecution"),
                       done(1.5 + number, f"b{number}", "No bash code execution result returned", "failed")]
        export = {"session": {"id": "s"}, "spans": spans_for_turn(2), "frames": [*frames, end(5)]}
        flags = turn_context.for_session(export, ["BashCodeExecution"])[0]["flags"]
        self.assertEqual(flags[0]["id"], "repeated-failure")
        self.assertIn("3 times", flags[0]["text"])

    def test_an_export_from_before_docs_selection_was_fetched_has_no_missing_span_flag(self):
        spans = {"tools": {}, "model_calls": []}
        export = {"session": {"id": "s"}, "spans": spans, "frames": [
            prompt(0), *code_failure(1, "c1", "boom"), end(2),
        ]}
        self.assertEqual(turn_context.for_session(export, ["ExecuteCode"])[0]["flags"], [])

    def test_a_short_turn_does_not_lend_its_spans_to_the_next(self):
        spans = spans_for_turn(0)
        export = {"session": {"id": "s"}, "spans": spans, "frames": [prompt(0), end(2), prompt(3), end(4)]}
        contexts = turn_context.for_session(export, ["ExecuteCode"])
        self.assertIsNotNone(contexts[0]["documentation"])
        self.assertIsNone(contexts[1]["documentation"])
        self.assertEqual(contexts[1]["tools"]["offered"], 0)

    def test_unknown_eager_names_leave_deferred_unknown(self):
        export = {"session": {"id": "s"}, "spans": spans_for_turn(2), "frames": [prompt(0), end(1)]}
        self.assertIsNone(turn_context.for_session(export, None)[0]["tools"]["deferred"])

    def test_without_spans_there_is_no_context(self):
        self.assertEqual(turn_context.for_session({"session": {"id": "s"}, "frames": [prompt(0)]}, []), [])


class Cli(unittest.TestCase):
    def test_the_password_leaves_the_url(self):
        url, password = cli.without_password("postgresql://reader:p%40ss@db:5432/macro?sslmode=require")
        self.assertEqual(url, "postgresql://reader@db:5432/macro?sslmode=require")
        self.assertEqual(password, "p@ss")

    def test_postgres_times_with_trimmed_fractions_parse(self):
        self.assertEqual(cli.postgres_time("2026-11-09T10:00:00.12+00:00").microsecond, 120000)
        self.assertEqual(cli.postgres_time("2026-11-09T10:00:00.1+00").microsecond, 100000)

    def test_serve_answers_only_its_own_page(self):
        with tempfile.TemporaryDirectory() as directory:
            page = pathlib.Path(directory) / "s.html"
            page.write_text("<p>page</p>")
            (pathlib.Path(directory) / "other.html").write_text("private")
            handler = type("Handler", (cli.OneFile,), {"path_served": page, "log_message": lambda *args: None})
            server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            base = f"http://127.0.0.1:{server.server_address[1]}"
            try:
                with urllib.request.urlopen(base + "/s.html") as response:
                    self.assertEqual(response.read(), b"<p>page</p>")
                with self.assertRaises(urllib.error.HTTPError) as missing:
                    urllib.request.urlopen(base + "/other.html")
                self.assertEqual(missing.exception.code, 404)
            finally:
                server.shutdown()
                server.server_close()

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
