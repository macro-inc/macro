"""Tests for the viewer's exporters: python3 -m unittest discover tooling/agent-session-view"""
import http.server
import importlib.machinery
import importlib.util
import json
import pathlib
import subprocess
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from unittest import mock

import datadog_spans
import markdown_export
import reconstruct
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

    def test_code_sent_after_the_call_starts_is_kept(self):
        turns = markdown_export.parse([
            prompt(0),
            call(1, "a", "mcp__macro_internal__ExecuteCode"),
            update(1.2, sessionUpdate="tool_call_update", toolCallId="a", status="in_progress",
                   rawInput={"source": "export async function main() {}", "acting_as": "requester"}),
            done(2, "a", {"status": "succeeded"}),
            call(3, "b", "BashCodeExecution"),
            update(3.1, sessionUpdate="tool_call_update", toolCallId="b", rawInput={"input": "ls -la"}),
            done(4, "b", {}),
            end(5),
        ])
        first, second = turns[0].steps
        self.assertEqual(first.code, "export async function main() {}")
        self.assertEqual(first.arguments, {"acting_as": "requester"})
        self.assertEqual(second.code, "ls -la")

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
                "tags": ["region:us-east-1", "task_family:agent-harness-service-1a2b3c4d", "task_version:3"],
                "custom": {"selection_status": "selected", "selected": "2", "selected_entities": "channels,users",
                           "bytes": "20111", "guidance": "Inline", "batches": "2"}}
        self.assertEqual(datadog_spans.documentation(span), {
            "trace_id": "t1", "start_ms": 1794218400000.0, "status": "selected", "selected": 2,
            "entities": ["channels", "users"], "bytes": 20111, "guidance": "Inline", "batches": 2,
            "task_definition": "agent-harness-service-1a2b3c4d:3",
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


RELEASE_RUNS = {"workflow_runs": [
    {"name": "Deploy Production Release", "status": "completed", "conclusion": "success", "head_sha": "aaa111", "head_branch": "v2026.11.16.0",
     "created_at": "2026-11-16T14:09:45Z", "updated_at": "2026-11-16T14:41:20Z"},
    {"name": "Deploy Production Release", "status": "completed", "conclusion": "success", "head_sha": "bbb222", "head_branch": "v2026.11.16.1",
     "created_at": "2026-11-16T23:15:25Z", "updated_at": "2026-11-16T23:35:38Z"},
    {"name": "Android APK on Release", "status": "completed", "conclusion": "success", "head_sha": "ccc333", "head_branch": "v2026.11.16.1",
     "created_at": "2026-11-16T23:15:25Z", "updated_at": "2026-11-16T23:51:09Z"},
]}


# The 2026-11-18 production deploys: the last three concluded "failure"
# because an unrelated worker job failed, though each deployed the harness.
RUNS_2026_11_18 = {"workflow_runs": [
    {"name": "Deploy Production Release", "status": "completed", "conclusion": conclusion, "head_sha": sha,
     "head_branch": tag, "created_at": created, "updated_at": updated}
    for tag, sha, conclusion, created, updated in [
        ("v2026.11.18.0", "7b93e795a5a", "failure", "2026-11-18T18:24:30Z", "2026-11-18T19:02:03Z"),
        ("v2026.11.17.1", "dce2afa890f", "failure", "2026-11-18T00:08:45Z", "2026-11-18T01:22:25Z"),
        ("v2026.11.17.0", "87308ca67aa", "failure", "2026-11-17T21:43:40Z", "2026-11-17T22:50:33Z"),
        ("v2026.11.16.1", "cd959802725", "success", "2026-11-16T23:15:25Z", "2026-11-16T23:35:38Z"),
        ("v2026.11.16.0", "f2cc9feea1a", "success", "2026-11-16T14:09:45Z", "2026-11-16T14:41:20Z"),
    ]
]}
RELEASES_2026_11_18 = [
    {"tag_name": tag, "published_at": published, "draft": False, "prerelease": False}
    for tag, published in [
        ("v2026.11.18.0", "2026-11-18T18:24:27Z"), ("v2026.11.17.1", "2026-11-18T00:08:43Z"),
        ("v2026.11.17.0", "2026-11-17T21:43:38Z"), ("v2026.11.16.1", "2026-11-16T23:15:23Z"),
        ("v2026.11.16.0", "2026-11-16T14:09:41Z"),
    ]
]


def github(runs, releases, tags=None, registered=None, attempts=None):
    """A `subprocess.run` stand-in for the deploy lookup's `gh` and `aws` reads."""
    def run(args, **_):
        if args[0] == "aws":
            if registered is None:
                raise subprocess.CalledProcessError(255, args)
            return completed(json.dumps(registered))
        path = args[2]
        if "/attempts/" in path:
            return completed(json.dumps((attempts or {})[path]))
        if "/actions/runs" in path:
            return completed(json.dumps(runs))
        if "/releases" in path:
            if releases is None:
                raise subprocess.CalledProcessError(1, args)
            return completed(json.dumps(releases))
        if "/commits/" in path:
            return completed(json.dumps((tags or {})[path.rsplit("/", 1)[1]]))
        raise AssertionError(args)
    return run


def lookup(task, turn_started, runs, releases, **fake):
    with mock.patch("subprocess.run", side_effect=github(runs, releases, **fake)):
        return reconstruct.deploy_commit(task, reconstruct.iso(turn_started), "prod", reconstruct.production_deploys())


def completed(stdout):
    return mock.Mock(returncode=0, stdout=stdout, stderr="")


class Reconstruct(unittest.TestCase):
    def test_a_part_is_verified_by_the_harness_hash(self):
        text = "\n<macro_sdk>\ncatalog</macro_sdk>\n"
        self.assertEqual(reconstruct.short_hash(text), __import__("hashlib").sha256(text.encode()).hexdigest()[:16])
        self.assertEqual(reconstruct.check("sdk_docs", text, len(text), reconstruct.short_hash(text))["status"],
                         "verified")
        self.assertEqual(reconstruct.check("sdk_docs", text, len(text), "0000000000000000")["status"], "mismatch")
        self.assertEqual(reconstruct.check("sdk_docs", text, None, None)["status"], "unverified")

    def test_the_commit_is_the_deploy_that_registered_the_task(self):
        asked = []
        fake = github(RELEASE_RUNS, [], registered="2026-11-16T23:31:34.381000+00:00")

        def run(args, **kwargs):
            asked.append(args)
            return fake(args, **kwargs)
        with mock.patch("subprocess.run", side_effect=run):
            commit = reconstruct.deploy_commit("agent-harness-service-52dc1429:1",
                                               reconstruct.iso("2026-11-17T16:00:42Z"), "prod",
                                               reconstruct.production_deploys())
        self.assertIn("agent-harness-service-52dc1429:1", asked[2])
        self.assertEqual(commit["sha"], "bbb222")
        self.assertTrue(commit["exact"])

    def test_an_unreadable_task_falls_back_to_the_last_deploy_with_its_reason(self):
        commit = lookup("agent-harness-service-52dc1429:1", "2026-11-16T20:00:00Z", RELEASE_RUNS, [])
        self.assertEqual(commit["sha"], "aaa111")
        self.assertFalse(commit["exact"])
        self.assertIn("not readable", commit["reason"])
        self.assertIn("inferred: v2026.11.16.0", commit["reason"])

    def test_a_deploy_run_that_failed_elsewhere_still_registered_the_task(self):
        commit = lookup("agent-harness-service-8410addf:1", "2026-11-18T19:30:00Z",
                        RUNS_2026_11_18, RELEASES_2026_11_18, registered="2026-11-18T18:55:51.371000+00:00")
        self.assertEqual(commit["sha"], "7b93e795a5a")
        self.assertTrue(commit["exact"])
        self.assertIn("v2026.11.18.0", commit["reason"])
        self.assertIn("failure", commit["reason"])

    def test_without_the_task_the_newest_release_deployed_before_the_turn_is_inferred(self):
        commit = lookup("agent-harness-service-8410addf:1", "2026-11-18T19:30:00Z",
                        RUNS_2026_11_18, RELEASES_2026_11_18)
        self.assertEqual(commit["sha"], "7b93e795a5a")
        self.assertFalse(commit["exact"])
        self.assertIn("v2026.11.18.0", commit["reason"])

    def test_a_release_still_deploying_at_the_turn_is_not_inferred(self):
        commit = lookup(None, "2026-11-18T18:40:00Z", RUNS_2026_11_18, RELEASES_2026_11_18)
        self.assertEqual(commit["sha"], "dce2afa890f")
        self.assertFalse(commit["exact"])

    def test_a_release_with_no_listed_run_is_inferred_from_its_tag_time(self):
        runs = {"workflow_runs": RUNS_2026_11_18["workflow_runs"][3:]}
        commit = lookup(None, "2026-11-18T19:30:00Z", runs, RELEASES_2026_11_18,
                        tags={"v2026.11.18.0": {"sha": "7b93e795a5a09dd"}})
        self.assertEqual(commit["sha"], "7b93e795a5a09dd")
        self.assertFalse(commit["exact"])
        self.assertIn("v2026.11.18.0", commit["reason"])
        self.assertIn("no deploy run listed", commit["reason"])

    def test_an_older_only_listing_does_not_jump_ahead(self):
        runs = {"workflow_runs": RUNS_2026_11_18["workflow_runs"][3:]}
        commit = lookup("agent-harness-service-8410addf:1", "2026-11-18T19:30:00Z",
                        runs, RELEASES_2026_11_18[3:], registered="2026-11-18T18:55:51.371000+00:00")
        self.assertEqual(commit["sha"], "cd959802725")
        self.assertFalse(commit["exact"])
        self.assertIn("no production deploy run spans", commit["reason"])

    def test_a_deploy_still_running_registered_a_task_after_its_last_update(self):
        running = [dict(RUNS_2026_11_18["workflow_runs"][0], status="in_progress", conclusion=None,
                        updated_at="2026-11-18T18:50:00Z")] + RUNS_2026_11_18["workflow_runs"][1:]
        commit = lookup("agent-harness-service-8410addf:1", "2026-11-18T19:00:00Z", {"workflow_runs": running},
                        RELEASES_2026_11_18, registered="2026-11-18T18:55:51.371000+00:00")
        self.assertEqual(commit["sha"], "7b93e795a5a")
        self.assertTrue(commit["exact"])
        self.assertIn("in_progress", commit["reason"])

    def test_a_rerun_older_release_does_not_overtake_a_newer_one(self):
        runs = [dict(run) for run in RUNS_2026_11_18["workflow_runs"]]
        runs[1].update(id=2, run_attempt=2, updated_at="2026-11-18T19:20:00Z")
        attempts = {"repos/{owner}/{repo}/actions/runs/2/attempts/1": {"updated_at": "2026-11-18T01:22:25Z"}}
        commit = lookup(None, "2026-11-18T19:30:00Z", {"workflow_runs": runs}, RELEASES_2026_11_18,
                        attempts=attempts)
        self.assertEqual(commit["sha"], "7b93e795a5a")

    def test_a_rerun_counts_from_its_first_attempt_end(self):
        runs = [dict(run) for run in RUNS_2026_11_18["workflow_runs"]]
        runs[0].update(id=1, run_attempt=2, status="in_progress", conclusion=None, updated_at="2026-11-18T20:00:00Z")
        attempts = {"repos/{owner}/{repo}/actions/runs/1/attempts/1": {"updated_at": "2026-11-18T19:02:03Z"}}
        early = lookup(None, "2026-11-18T18:40:00Z", {"workflow_runs": runs}, RELEASES_2026_11_18, attempts=attempts)
        late = lookup(None, "2026-11-18T19:30:00Z", {"workflow_runs": runs}, RELEASES_2026_11_18, attempts=attempts)
        self.assertEqual((early["sha"], late["sha"]), ("dce2afa890f", "7b93e795a5a"))

    def test_a_queued_run_registered_nothing(self):
        queued = [dict(RUNS_2026_11_18["workflow_runs"][0], status="queued", conclusion=None,
                       created_at="2026-11-18T18:50:00Z", updated_at="2026-11-18T18:50:00Z")]
        commit = lookup("agent-harness-service-8410addf:1", "2026-11-18T19:30:00Z",
                        {"workflow_runs": queued + RUNS_2026_11_18["workflow_runs"][1:]}, RELEASES_2026_11_18,
                        registered="2026-11-18T18:55:51.371000+00:00")
        self.assertFalse(commit["exact"])

    def test_an_unreadable_release_listing_keeps_the_exact_match(self):
        commit = lookup("agent-harness-service-8410addf:1", "2026-11-18T19:30:00Z", RUNS_2026_11_18, None,
                        registered="2026-11-18T18:55:51.371000+00:00")
        self.assertEqual(commit["sha"], "7b93e795a5a")
        self.assertTrue(commit["exact"])

    def test_a_prerelease_is_never_inferred(self):
        runs = {"workflow_runs": RUNS_2026_11_18["workflow_runs"][1:]}
        releases = [dict(RELEASES_2026_11_18[0], prerelease=True)] + RELEASES_2026_11_18[1:]
        commit = lookup(None, "2026-11-18T19:30:00Z", runs, releases)
        self.assertEqual(commit["sha"], "dce2afa890f")

    def test_an_unseen_turn_checks_neither_the_session_preamble_nor_a_macro_prompt(self):
        output = {"preamble": "P", "macro_prompt": "inline", "routed_macro_prompt": "routed",
                  "identities": [], "integrations": [], "docs": []}
        call_row = {"start_ms": seconds(1) * 1000, "eager_tools": 4,
                    "prompt_bytes": {"preamble": 40}, "prompt_hashes": {"preamble": "0123456789abcdef"}}
        turn = markdown_export.parse([prompt(0), end(5)])[0]
        found = reconstruct.parts({"documentation": None}, turn, [call_row], output, iter([]))
        self.assertEqual([(part["name"], part["status"]) for part in found], [("preamble", "not reconstructed")])

    def test_candidates_of_one_size_without_a_hash_stay_unverified(self):
        sizes = {"identity": 3}
        part = reconstruct.inferred("identity", ["Ada", "ada"], sizes, {}, "inferred")
        self.assertEqual(part["status"], "unverified")
        self.assertEqual(reconstruct.inferred("identity", ["Ada", "Bo"], sizes, {}, "inferred")["status"], "verified")

    def test_parts_pick_the_routed_prompt_by_guidance_and_flag_a_docs_byte_mismatch(self):
        docs = "\n<macro_sdk>\ncatalog</macro_sdk>\n"
        output = {"preamble": "P", "macro_prompt": "inline guides", "routed_macro_prompt": "routed",
                  "identities": [], "integrations": [], "docs": [docs]}
        call_row = {"start_ms": seconds(1) * 1000, "eager_tools": 4,
                    "prompt_bytes": {"preamble": 1, "macro_prompt": 6, "memory": 900, "sdk_docs": len(docs)},
                    "prompt_hashes": {"preamble": reconstruct.short_hash("P"),
                                      "macro_prompt": reconstruct.short_hash("routed"),
                                      "sdk_docs": reconstruct.short_hash(docs)}}
        turn = markdown_export.parse([prompt(0), end(5)])[0]
        context = {"documentation": {"entities": [], "guidance": "Selected", "bytes": 999}}
        found = {part["name"]: part for part in reconstruct.parts(context, turn, [call_row], output, iter(output["docs"]))}
        self.assertEqual(found["preamble"]["status"], "verified")
        self.assertEqual(found["macro_prompt"]["text"], "routed")
        self.assertEqual(found["memory"]["status"], "not reconstructed")
        self.assertIsNone(found["memory"]["text"])
        self.assertEqual(found["sdk_docs"]["status"], "mismatch")
        self.assertIn("999", found["sdk_docs"]["note"])

    def test_a_turn_texts_move_out_once_by_hash(self):
        contexts = [{"literal": {"parts": [{"hash": "h1", "text": "same"}]}},
                    {"literal": {"parts": [{"hash": "h1", "text": "same"}, {"hash": None, "text": None}]}}]
        self.assertEqual(reconstruct.texts(contexts), {"h1": "same"})
        self.assertNotIn("text", contexts[0]["literal"]["parts"][0])


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
