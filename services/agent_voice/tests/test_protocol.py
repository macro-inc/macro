import json
import unittest
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from protocol import TaskEvent, TaskLedger, VoiceJob, public_context, task_prompt


def job_data():
    return {
        "schemaVersion": 1,
        "sessionId": str(uuid4()),
        "voiceSessionId": str(uuid4()),
        "participantIdentity": "voice-user-1",
        "agentIdentity": "voice-agent-1",
        "voice": "marin",
        "expiresAt": (datetime.now(timezone.utc) + timedelta(minutes=29)).isoformat(),
    }


class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.data = job_data()
        self.job = VoiceJob.parse(json.dumps(self.data))
        self.task = str(uuid4())

    def event(self, sequence=1, kind="completed", **overrides):
        return json.dumps({
            "version": 1, "voiceSessionId": self.job.voice_session_id,
            "taskId": self.task, "seq": sequence, "type": kind,
            "text": "The draft is ready for review.", **overrides,
        }).encode()

    def test_expired_unbounded_and_unknown_voice_jobs_fail_closed(self):
        for change in [
            {"expiresAt": (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()},
            {"expiresAt": (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()},
            {"expiresAt": "2026-09-22T12:00:00"},
            {"voice": "unknown"},
            {"agentIdentity": "voice-user-1"},
            {"schemaVersion": 2},
            {"schemaVersion": True},
        ]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                VoiceJob.parse(json.dumps(self.data | change))

    def test_event_identity_is_bound_to_caller_and_media_session(self):
        with self.assertRaises(ValueError):
            TaskEvent.parse(self.event(), self.job, "untrusted-agent")
        with self.assertRaises(ValueError):
            TaskEvent.parse(self.event(voiceSessionId=str(uuid4())), self.job, self.job.participant_identity)

    def test_malformed_sequence_and_oversized_content_are_rejected(self):
        for sequence in [-1, True, "2"]:
            with self.subTest(sequence=sequence), self.assertRaises(ValueError):
                TaskEvent.parse(self.event(sequence=sequence), self.job, self.job.participant_identity)
        with self.assertRaises(ValueError):
            TaskEvent.parse(self.event(text="x" * 8_001), self.job, self.job.participant_identity)

    def test_terminal_status_survives_a_tool_only_reply_with_no_public_text(self):
        for kind in ("completed", "cancelled", "failed"):
            parsed = TaskEvent.parse(self.event(kind=kind, text=""), self.job, self.job.participant_identity)
            self.assertEqual(parsed.kind, kind)
            self.assertEqual(parsed.text, "")
        with self.assertRaises(ValueError):
            TaskEvent.parse(self.event(kind="progress", text=""), self.job, self.job.participant_identity)

    def test_replay_unknown_tasks_and_late_progress_do_not_speak(self):
        ledger = TaskLedger()
        progress = TaskEvent(self.task, 2, "progress", "Reading")
        self.assertFalse(ledger.accept(progress))
        ledger.register(self.task)
        self.assertTrue(ledger.accept(progress))
        self.assertFalse(ledger.accept(progress))
        self.assertFalse(ledger.accept(TaskEvent(self.task, 1, "progress", "Earlier")))
        self.assertTrue(ledger.accept(TaskEvent(self.task, 3, "completed", "Done")))
        self.assertFalse(ledger.accept(TaskEvent(self.task, 4, "progress", "Late")))

    def test_superseded_results_are_recorded_but_not_presented(self):
        ledger = TaskLedger()
        ledger.register(self.task)
        ledger.supersede(self.task)
        self.assertFalse(ledger.accept(TaskEvent(self.task, 1, "completed", "Old result")))
        self.assertTrue(ledger.tasks[self.task].terminal)

    def test_same_provider_call_maps_to_same_action_after_retry(self):
        self.assertEqual(self.job.request_id("call_1"), self.job.request_id("call_1"))
        self.assertNotEqual(self.job.request_id("call_1"), self.job.request_id("call_2"))

    def test_context_drops_private_roles_and_is_bounded(self):
        raw = json.dumps({
            "version": 1, "sessionId": self.job.session_id,
            "messages": [
                {"role": "thought", "text": "Do not speak this"},
                {"role": "user", "text": "x" * 2_500},
                {"role": "assistant", "text": "The public answer"},
            ],
        })
        context = public_context(raw, self.job)
        self.assertEqual(len(context), 2)
        self.assertEqual(len(context[0]["text"]), 2_000)
        self.assertEqual(context[-1]["text"], "The public answer")

    def test_context_cannot_cross_agent_sessions(self):
        with self.assertRaises(ValueError):
            public_context(json.dumps({"version": 1, "sessionId": str(uuid4()), "messages": []}), self.job)

    def test_multilingual_prompt_stays_within_rpc_budget(self):
        prompt = task_prompt("查找我的文件", [{"role": "user", "text": "界" * 2_000}] * 8)
        self.assertLess(len(json.dumps({"prompt": prompt}, ensure_ascii=False).encode()), 15_000)
        with self.assertRaises(ValueError):
            task_prompt("界" * 6_000, [])


if __name__ == "__main__":
    unittest.main()
