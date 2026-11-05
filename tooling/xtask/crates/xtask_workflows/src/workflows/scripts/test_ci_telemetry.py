"""Scenarios for the CI telemetry collector. Run by xtask_workflows' tests."""

import datetime
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))

import ci_telemetry_collect as collect  # noqa: E402
import ci_telemetry_send as send  # noqa: E402

REPO = "acme/repo"
UTC = datetime.timezone.utc


def at(minute, second=0):
    return f"2026-01-01T10:{minute:02d}:{second:02d}Z"


def when(minute, second=0):
    return datetime.datetime(2026, 1, 1, 10, minute, second, tzinfo=UTC)


def run(**overrides):
    return {
        "id": 1,
        "name": "code check",
        "run_attempt": 1,
        "event": "pull_request",
        "head_sha": "abc",
        "head_branch": "someone/some-change",
        "status": "completed",
        "conclusion": "success",
        "created_at": at(0, 10),
        "pull_requests": [{"number": 7}],
        **overrides,
    }


def job(name="test", start=at(1), end=at(5), **overrides):
    return {
        "id": 11,
        "name": name,
        "conclusion": "success",
        "created_at": at(0, 40),
        "started_at": start,
        "completed_at": end,
        "labels": ["namespace-profile-linux-large;overrides.cache-tag=x"],
        "steps": [],
        **overrides,
    }


def step(name, start, end, conclusion="success"):
    return {"name": name, "started_at": start, "completed_at": end, "conclusion": conclusion}


class ClassifyFiles(unittest.TestCase):
    def test_types(self):
        cases = {
            ("apps/web/src/a.tsx",): "web",
            ("infra/stacks/a.ts", ".github/workflows/a.yml"): "infra",
            ("docs/a.md",): "other",
            ("crates/a/src/lib.rs", "apps/web/b.ts"): "mixed",
            ("crates/a/src/lib.rs",): "rust-small",
            ("crates/a/src/lib.rs", "docs/a.md", "infra/a.ts"): "rust-small",
            tuple(f"crates/c{i}/src/lib.rs" for i in range(5)): "rust-medium",
            tuple(f"crates/c{i}/src/lib.rs" for i in range(10)): "rust-large",
            ("Cargo.lock",): "rust-large",
        }
        for paths, expected in cases.items():
            self.assertEqual(collect.classify_files(paths)[0], expected, paths)

    def test_xtask_rust_counts_as_rust_not_infra(self):
        self.assertEqual(collect.classify_files(["tooling/xtask/src/a.rs"])[0], "rust-small")


class ClockStart(unittest.TestCase):
    def test_push_starts_the_clock(self):
        self.assertEqual(collect.clock_start(when(0, 10), when(0), when(0) - datetime.timedelta(days=1)), (when(0), "push"))

    def test_opening_the_pr_after_the_push_starts_the_clock(self):
        self.assertEqual(collect.clock_start(when(5, 10), when(0), when(5)), (when(5), "pr_open"))

    def test_old_push_falls_back_to_the_first_run(self):
        self.assertEqual(collect.clock_start(when(30), when(0), None), (when(30), "first_run"))

    def test_unknown_push_falls_back_to_the_first_run(self):
        self.assertEqual(collect.clock_start(when(0), None, when(0)), (when(0), "first_run"))


class JobEvents(unittest.TestCase):
    def test_job_has_queue_and_volume(self):
        steps = [step(collect.DEV_SHELL_STEP, at(1), at(1, 4)), step("instant", at(1), at(1))]
        events = collect.job_events(REPO, run(), [job(steps=steps)])
        attributes = events[0][2]
        self.assertEqual(attributes["queue_seconds"], 20)
        self.assertEqual(attributes["run_seconds"], 240)
        self.assertEqual(attributes["volume_state"], "warm")
        self.assertEqual(attributes["runner_profile"], "namespace-profile-linux-large")
        self.assertEqual([event[2]["event"] for event in events], ["job", "step"])

    def test_slow_dev_shell_means_cold(self):
        steps = [step(collect.DEV_SHELL_STEP, at(1), at(3))]
        self.assertEqual(collect.job_events(REPO, run(), [job(steps=steps)])[0][2]["volume_state"], "cold")

    def test_partial_rerun_copy_has_no_queue_time(self):
        attributes = collect.job_events(REPO, run(), [job(created_at=at(9))])[0][2]
        self.assertNotIn("queue_seconds", attributes)

    def test_skipped_job_is_left_out(self):
        self.assertEqual(collect.job_events(REPO, run(), [job(conclusion="skipped")]), [])

    def test_trace_ids_match_the_exporter(self):
        # A real run and the id its trace has in Tempo.
        trace_id, span_id = collect.trace_ids("macro-inc/macro", {"id": 42073661884, "run_attempt": 1})
        self.assertEqual(trace_id, "6957c75506a4f45cba526240dd419983")
        self.assertEqual(len(span_id), 16)


class PushEvent(unittest.TestCase):
    def push(self, runs, jobs, pushed=None, files=("crates/a/src/lib.rs",), pull_request=None, head=None):
        return collect.push_event(REPO, head or runs[0], runs, jobs, pushed, pull_request, files)

    def test_wall_is_push_to_last_job_across_workflows(self):
        runs = [run(), run(id=2, name="web")]
        jobs = {1: [job(end=at(5))], 2: [job("build", end=at(7), id=12)]}
        body, end, attributes, _ = self.push(runs, jobs, pushed=when(0))
        self.assertEqual(attributes["wall_seconds"], 420)
        self.assertEqual(attributes["wall_start"], "push")
        self.assertEqual(attributes["start_lag_seconds"], 10)
        self.assertEqual(attributes["last_job"], "build")
        self.assertEqual(attributes["last_workflow"], "web")
        self.assertEqual(end, when(7))

    def test_roll_up_job_ends_the_wall_but_is_not_the_last_job(self):
        jobs = {1: [job("test", end=at(5)), job("Cloud Storage Status Check", start=at(5), end=at(6), id=12)]}
        attributes = self.push([run()], jobs)[2]
        self.assertEqual(attributes["last_job"], "test")
        self.assertEqual(attributes["wall_seconds"], 350)

    def test_same_push_gives_the_same_line_from_either_completion(self):
        runs = [run(), run(id=2, name="web")]
        jobs = {1: [job()], 2: [job("build", id=12)]}
        first = self.push(runs, jobs)
        second = self.push(runs, jobs, head=runs[1])
        self.assertEqual(first[:2], second[:2])

    def test_rerun_is_flagged_and_gets_a_new_line(self):
        first = self.push([run()], {1: [job()]})
        rerun = self.push([run(run_attempt=2)], {1: [job()]})
        self.assertTrue(rerun[2]["rerun"])
        self.assertNotEqual(first[0], rerun[0])

    def test_any_failure_fails_the_push(self):
        runs = [run(), run(id=2, conclusion="failure")]
        self.assertEqual(self.push(runs, {1: [job()], 2: [job(id=12)]})[2]["conclusion"], "failure")

    def test_no_job_ran_is_no_event(self):
        self.assertIsNone(self.push([run()], {1: []}))

    def test_experiment_branch_is_flagged_and_never_named(self):
        head = run(head_branch="someone/ci-probe")
        event = self.push([head], {1: [job()]})
        self.assertTrue(event[2]["experiment"])
        self.assertNotIn("someone", json.dumps(event[2]))

    def test_no_pr_is_unknown_type(self):
        self.assertEqual(self.push([run()], {1: [job()]}, files=None)[2]["pr_type"], "unknown")


class FakeGithub:
    def __init__(self, responses):
        self.responses = responses
        self.calls = 0
        self.rate_limit = self.rate_remaining = None

    def get(self, path, **_):
        self.calls += 1
        response = self.responses[path]
        if isinstance(response, Exception):
            raise response
        return response


class CollectPush(unittest.TestCase):
    def responses(self, *runs_):
        return {
            "actions/runs": {"workflow_runs": list(runs_)},
            "actions/runs/1/attempts/1/jobs": {"jobs": [job()]},
            "actions/runs/2/attempts/1/jobs": {"jobs": [job("build", id=12)]},
            "pulls/7": {"created_at": at(0), "draft": False},
            "pulls/7/files": [{"filename": "apps/web/a.ts"}],
            "activity": [{"after": "abc", "timestamp": at(0, 5)}],
        }

    def test_waits_for_every_check(self):
        github = FakeGithub(self.responses(run(), run(id=2, status="in_progress", conclusion=None)))
        self.assertIsNone(collect.collect_push(github, REPO, run()))
        self.assertEqual(github.calls, 1)

    def test_finished_push_is_classified(self):
        github = FakeGithub(self.responses(run(), run(id=2)))
        attributes = collect.collect_push(github, REPO, run())[2]
        self.assertEqual(attributes["pr_type"], "web")
        self.assertEqual(attributes["wall_start"], "push")

    def test_cleanup_and_other_events_do_not_block(self):
        github = FakeGithub(
            self.responses(
                run(),
                run(id=3, name="Cleanup Preview", status="in_progress"),
                run(id=4, event="push", status="in_progress"),
            )
        )
        self.assertIsNotNone(collect.collect_push(github, REPO, run()))

    def test_main_push_has_no_push_event(self):
        github = FakeGithub({})
        self.assertIsNone(collect.collect_push(github, REPO, run(event="push")))
        self.assertEqual(github.calls, 0)

    def test_error_keeps_the_job_events(self):
        responses = self.responses(run())
        responses["actions/runs"] = RuntimeError("boom")
        events = collect.collect(FakeGithub(responses), REPO, run())
        self.assertEqual([event[2]["event"] for event in events], ["job"])


class Otlp(unittest.TestCase):
    def test_records_are_typed_and_clamped(self):
        now = when(59)
        document = collect.to_otlp([("line", when(0), {"a": 1, "b": "x", "c": True}, ("t" * 32, "s" * 16))], now)
        record = document["resourceLogs"][0]["scopeLogs"][0]["logRecords"][0]
        self.assertEqual(
            int(record["timeUnixNano"]),
            int((now - datetime.timedelta(seconds=collect.MAX_EVENT_AGE_SECONDS)).timestamp()) * 1_000_000_000,
        )
        self.assertEqual(
            record["attributes"],
            [
                {"key": "a", "value": {"intValue": "1"}},
                {"key": "b", "value": {"stringValue": "x"}},
                {"key": "c", "value": {"boolValue": True}},
            ],
        )
        self.assertEqual(record["traceId"], "t" * 32)


class Send(unittest.TestCase):
    def test_reads_the_credential_steps_header_form(self):
        self.assertEqual(send.authorization("Authorization=Bearer%20a%2Fb"), ("Authorization", "Bearer a/b"))


if __name__ == "__main__":
    unittest.main()
