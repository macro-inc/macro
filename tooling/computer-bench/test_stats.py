"""Tests for the bench statistics: python3 -m unittest discover tooling/computer-bench"""

import unittest

import stats


class PercentileTest(unittest.TestCase):
    def test_nearest_rank(self) -> None:
        values = list(range(1, 21))
        self.assertEqual(stats.percentile(values, 50), 10)
        self.assertEqual(stats.percentile(values, 95), 19)
        self.assertEqual(stats.percentile(values, 100), 20)

    def test_one_value_is_every_percentile(self) -> None:
        self.assertEqual(stats.percentile([7.5], 50), 7.5)
        self.assertEqual(stats.percentile([7.5], 95), 7.5)

    def test_order_of_input_does_not_matter(self) -> None:
        self.assertEqual(stats.percentile([3, 1, 2], 50), 2)


class E2ePhasesTest(unittest.TestCase):
    def test_seconds_from_buy_with_marker_trace_and_host_phases(self) -> None:
        record = {
            "t_buy": 100.0,
            "t_bought": 103.5,
            "t_connected": 132.0,
            "t_prompt": 132.1,
            "t_reply": 140.1,
            "t_released": 150.0,
            "clock_offset": 0.5,
            "marker": {"t": 127.5},
            "trace": [{"name": "computer.setup", "start": 100.0, "end": 132.0}],
            "host_computer": {"lastLaunch": {"macroRestoreMs": 1340, "totalMs": 1600, "note": "x"}},
        }
        self.assertEqual(
            stats.phases(record),
            {
                "bought": 3.5,
                "connected": 32.0,
                "prompt": 32.099999999999994,
                "reply": 40.099999999999994,
                "prompt->reply": 8.0,
                "enroll_ready": 27.0,
                "enroll_ready->connected": 5.0,
                "host:macroRestore": 1.34,
                "host:total": 1.6,
                "span:computer.setup": 32.0,
            },
        )

    def test_connected_to_session_and_session_to_reply(self) -> None:
        record = {"t_buy": 0.0, "t_connected": 30.0, "t_session": 41.5, "t_reply": 44.5}
        phases = stats.phases(record)
        self.assertEqual(phases["connected->session"], 11.5)
        self.assertEqual(phases["session->reply"], 3.0)

    def test_agent_milestone_spans_from_buy(self) -> None:
        record = {
            "t_buy": 100.0,
            "t_agent_running": 112.0,
            "spans": {"agent_online_handler": {"start": 111.5, "end": 111.6}},
        }
        phases = stats.phases(record)
        self.assertEqual(phases["agent_running"], 12.0)
        self.assertEqual(phases["at:agent_online_handler"], 11.5)

    def test_released_and_booleans_are_not_phases(self) -> None:
        record = {"t_buy": 0.0, "t_released": 9.0, "t_connected": 5.0, "first_prompt_lost": True}
        self.assertEqual(stats.phases(record), {"connected": 5.0})


class HostPhasesTest(unittest.TestCase):
    def test_seconds_from_start_and_memory_in_mib(self) -> None:
        record = {
            "t_start": 10.0,
            "t_running": 10.5,
            "t_responsive": None,
            "rss_kib": 2048,
            "mem": {"pss_kib": 1024, "t_postcopy_done": 12.0},
        }
        self.assertEqual(
            stats.phases(record),
            {"running": 0.5, "rss_mib": 2.0, "pss_mib": 1.0, "postcopy_done": 2.0},
        )


class SummarizeTest(unittest.TestCase):
    def test_errors_are_counted_not_timed_and_lost_prompts_are_counted(self) -> None:
        records = [
            {"label": "fc", "t_buy": 0.0, "t_connected": 2.0, "prompt_attempts": 1},
            {"label": "fc", "t_buy": 0.0, "t_connected": 4.0, "prompt_attempts": 3},
            {"label": "fc", "t_buy": 0.0, "t_connected": 99.0, "error": "no agent reply"},
        ]
        group = stats.summarize(records)["fc"]
        self.assertEqual(group.phases["connected"], [2.0, 4.0])
        self.assertEqual(group.errors, 1)
        self.assertEqual((group.prompted, group.first_prompt_lost), (2, 1))

    def test_host_runs_are_labelled_by_backend_and_variant(self) -> None:
        records = [{"backend": "firecracker", "variant": "restore", "t_start": 0.0, "t_running": 1.0}]
        self.assertIn("firecracker-restore", stats.summarize(records))

    def test_render(self) -> None:
        records = [
            {"label": "fc", "t_buy": 0.0, "t_connected": 2.0, "prompt_attempts": 2},
            {"label": "fc", "t_buy": 0.0, "t_connected": 4.0, "prompt_attempts": 1},
        ]
        self.assertEqual(
            stats.render(stats.summarize(records)),
            "| backend | phase | n | p50 | p95 | min | max |\n"
            "| --- | --- | --- | --- | --- | --- | --- |\n"
            "| fc | connected | 2 | 2.000 s | 4.000 s | 2.000 | 4.000 |\n"
            "| fc | first prompt lost | 2 | 1 of 2 | | | |",
        )


if __name__ == "__main__":
    unittest.main()
