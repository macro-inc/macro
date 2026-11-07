import json
from pathlib import Path
import unittest
from unittest.mock import patch

from compare import compare_fields, compare_reports, normalize, run_case


SUITE = json.loads(Path(__file__).with_name("baseline.json").read_text())


class BaselineComparisonTests(unittest.TestCase):
    def test_aliases_resolve_without_requiring_real_accounts(self):
        fields = compare_fields(
            {"intent": "message", "recipients": ["julia@macro.com"], "body": "I'm going to be late"},
            "message", {"recipients": ["Julia"], "body": "I'm going to be late"}, SUITE,
        )
        self.assertTrue(all(field["pass"] for field in fields.values()))

    def test_invitee_order_and_case_do_not_change_the_result(self):
        fields = compare_fields(
            {"guests": ["julia@macro.com", "teo@macro.com"]},
            "calendar", {"guests": ["TEO", "Julia"]}, SUITE,
        )
        self.assertTrue(fields["guests"]["pass"])

    def test_email_cc_does_not_count_as_a_to_recipient(self):
        expected = {"recipients": ["julia@macro.com"], "cc": ["teo@macro.com"]}
        correct = compare_fields(expected, "email", {"recipients": ["Julia"], "cc": ["Teo"]}, SUITE)
        combined = compare_fields(expected, "email", {"recipients": ["Julia", "Teo"], "cc": []}, SUITE)
        self.assertTrue(all(field["pass"] for field in correct.values()))
        self.assertFalse(combined["recipients"]["pass"])
        self.assertFalse(combined["cc"]["pass"])

    def test_named_channels_match_without_accepting_a_partial_name(self):
        expected = {"recipients": ["Bug Reports"]}
        correct = compare_fields(expected, "message", {"recipients": ["bug reports"]}, SUITE)
        partial = compare_fields(expected, "message", {"recipients": ["bug"]}, SUITE)
        self.assertTrue(correct["recipients"]["pass"])
        self.assertFalse(partial["recipients"]["pass"])

    def test_null_queries_are_empty_but_filter_wording_is_a_mismatch(self):
        expected = {"search_type": "Channels", "query": ""}
        empty = compare_fields(expected, "search", {"type": "channels", "query": None}, SUITE)
        repeated = compare_fields(expected, "search", {"type": "channels", "query": "messages from julia"}, SUITE)
        self.assertTrue(empty["query"]["pass"])
        self.assertTrue(empty["search_type"]["pass"])
        self.assertFalse(repeated["query"]["pass"])

    def test_note_markers_and_lost_sentences_are_not_hidden_by_the_comparison(self):
        fields = compare_fields(
            {"body": "First sentence.\n\nSecond sentence."},
            "note", {"body": "note: First sentence."}, SUITE,
        )
        self.assertFalse(fields["body"]["pass"])

    def test_dates_are_checked_as_local_wall_clock_times(self):
        suite = {**SUITE, "time_zone": "America/Los_Angeles"}
        self.assertEqual(normalize("start", "2026-10-28T15:00:00Z", suite), "2026-10-28T08:00")
        fields = compare_fields(
            {"start": "2026-10-28T08:00"}, "calendar", {"start": "2026-10-29T08:00"}, suite,
        )
        self.assertFalse(fields["start"]["pass"])

    def test_priority_comes_from_the_extracted_task_property(self):
        fields = compare_fields(
            {"priority": "high", "due_date": "2026-11-03"}, "task",
            {"properties": [{"name": "Priority", "values": ["High"]}], "due_date": "2026-11-03"}, SUITE,
        )
        self.assertTrue(all(field["pass"] for field in fields.values()))

    def test_titles_allow_concise_forms_but_not_the_description(self):
        expected = {"title": {"any_of": ["user reports notifications are broken", "notifications are broken"]}}
        concise = compare_fields(expected, "task", {"title": "Notifications are broken."}, SUITE)
        combined = compare_fields(expected, "task", {"title": "Notifications are broken. Clicking opens the wrong location."}, SUITE)
        self.assertTrue(concise["title"]["pass"])
        self.assertFalse(combined["title"]["pass"])

    def test_reports_identify_new_failures_and_fixes(self):
        before = {"suite_sha256": "same", "cases": [{"id": "a", "status": "pass"}, {"id": "b", "status": "fail"}]}
        after = {"suite_sha256": "same", "cases": [{"id": "a", "status": "fail"}, {"id": "b", "status": "pass"}]}
        self.assertEqual(compare_reports(before, after), {"regressions": ["a"], "improvements": ["b"]})
        with self.assertRaises(ValueError):
            compare_reports(before, {**after, "suite_sha256": "different"})

    @patch("compare.request")
    def test_wrong_classifications_are_not_corrected_by_forcing_the_expected_intent(self, request):
        request.return_value = {"scores": [{"intent": "ai", "score": 0.9}, {"intent": "message", "score": 0.1}]}
        result = run_case("message:1", "a message", {"intent": "message"}, SUITE, "http://localhost", {})
        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["fields"]["intent"]["actual"], "ai")
        request.assert_called_once()

    @patch("compare.request")
    def test_requests_use_the_frozen_clock_and_task_catalog(self, request):
        request.side_effect = [
            {"scores": [{"intent": "task", "score": 0.9}]},
            {"intent": "task", "suggestions": {"due_date": "2026-11-03"}},
        ]
        result = run_case("task:1", "due in one week", {"intent": "task", "due_date": "2026-11-03"}, SUITE, "http://localhost", {})
        self.assertEqual(result["status"], "pass")
        body = request.call_args_list[1].args[2]
        self.assertEqual(body["reference_time"], "2026-10-27T12:00:00Z")
        self.assertEqual(body["time_zone"], "UTC")
        self.assertEqual(body["property_definitions"], SUITE["property_definitions"])


if __name__ == "__main__":
    unittest.main()
