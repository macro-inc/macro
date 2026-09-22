"""No-network contracts against the pinned SDK and async result scheduling."""

import asyncio
import json
import unittest
from unittest.mock import patch

from livekit.agents import AgentSession, room_io

from agent import MacroVoiceAgent
from bridge import MacroBridge
from protocol import TaskEvent, VoiceJob
from test_protocol import job_data
from worker import create_model


class FakeSpeech:
    async def wait_for_playout(self):
        return None


class FakeSession:
    user_state = "listening"
    agent_state = "listening"

    def __init__(self):
        self.replies = []

    def generate_reply(self, **options):
        self.replies.append(options)
        return FakeSpeech()


class PresentationAgent(MacroVoiceAgent):
    def __init__(self, bridge):
        super().__init__(bridge, [])
        self.fake_session = FakeSession()

    @property
    def session(self):
        return self.fake_session


class SdkTests(unittest.IsolatedAsyncioTestCase):
    async def test_provider_configuration_and_session_construct_without_network(self):
        with patch.dict("os.environ", {}, clear=True):
            model = create_model("offline-placeholder-not-a-credential", "marin")
        try:
            self.assertTrue(model.capabilities.message_truncation)
            self.assertTrue(model.capabilities.turn_detection)
            self.assertEqual(model._opts.turn_detection.type, "semantic_vad")
            self.assertTrue(model._opts.turn_detection.interrupt_response)
            self.assertTrue(model._opts.turn_detection.create_response)
            self.assertEqual(model._opts.input_audio_noise_reduction.type, "near_field")
            self.assertEqual(model._opts.input_audio_transcription.model, "gpt-4o-transcribe")
            session = AgentSession(
                llm=model,
                turn_handling={"turn_detection": "realtime_llm", "interruption": {"enabled": True}},
                max_tool_steps=3,
            )
            self.assertEqual(session.turn_detection, "realtime_llm")
            options = room_io.RoomOptions(
                participant_identity="expected-user", audio_input=True,
                audio_output=True, video_input=False, text_input=False,
                text_output=True, close_on_disconnect=False, delete_room_on_close=True,
            )
            self.assertEqual(options.participant_identity, "expected-user")
            self.assertFalse(options.text_input)
            await session.aclose()
        finally:
            await model.aclose()


class PresentationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        async def rpc(_method, _payload):
            self.fail("Presentation never calls the harness")

        job = VoiceJob.parse(json.dumps(job_data()))
        self.bridge = MacroBridge(job, rpc)
        self.agent = PresentationAgent(self.bridge)
        self.delivery = asyncio.create_task(self.agent.deliver_results())
        self.task = job.request_id("task")
        self.bridge.ledger.register(self.task)

    async def asyncTearDown(self):
        self.delivery.cancel()
        await asyncio.gather(self.delivery, return_exceptions=True)
        await self.bridge.close()

    def enqueue(self, kind, sequence, text="", task_id=None):
        event = TaskEvent(task_id or self.task, sequence, kind, text)
        self.assertTrue(self.bridge.ledger.accept(event))
        self.agent.events.put_nowait(event)

    async def drain(self):
        await asyncio.wait_for(self.agent.events.join(), timeout=1)

    async def test_context_and_reply_wait_until_user_finishes_speaking(self):
        self.agent.fake_session.user_state = "speaking"
        self.enqueue("completed", 1, "The draft is ready.")
        await asyncio.sleep(0.01)
        self.assertFalse(self.agent.chat_ctx.items)
        self.assertFalse(self.agent.fake_session.replies)
        self.agent.fake_session.user_state = "listening"
        await self.drain()
        self.assertEqual(len(self.agent.chat_ctx.items), 1)
        self.assertEqual(len(self.agent.fake_session.replies), 1)
        self.assertEqual(self.agent.fake_session.replies[0]["tool_choice"], "none")
        self.assertTrue(self.agent.fake_session.replies[0]["allow_interruptions"])

    async def test_superseded_result_waiting_for_a_gap_never_speaks(self):
        self.agent.fake_session.user_state = "speaking"
        self.enqueue("completed", 1, "Old result")
        await asyncio.sleep(0.01)
        self.bridge.ledger.supersede(self.task)
        await self.drain()
        self.assertFalse(self.agent.chat_ctx.items)
        self.assertFalse(self.agent.fake_session.replies)

    async def test_queued_interaction_superseded_by_completion_is_not_presented(self):
        self.enqueue("interaction", 1, "Permission needed")
        self.enqueue("completed", 2, "Finished after permission was answered")
        await self.drain()
        self.assertEqual(len(self.agent.fake_session.replies), 1)
        self.assertIn("completed", self.agent.fake_session.replies[0]["instructions"])
        self.assertNotIn("Permission needed", self.agent.chat_ctx.items[0].text_content)

    async def test_progress_is_silent_and_replaced_by_terminal_status(self):
        self.enqueue("progress", 1, "Reading files")
        await self.drain()
        self.assertFalse(self.agent.fake_session.replies)
        self.enqueue("completed", 2)
        await self.drain()
        self.assertEqual(len(self.agent.chat_ctx.items), 1)
        self.assertNotIn("Reading files", self.agent.chat_ctx.items[0].text_content)
        self.assertEqual(len(self.agent.fake_session.replies), 1)

    async def test_presentation_notes_are_bounded_across_many_tasks(self):
        for index in range(10):
            task = self.bridge.job.request_id(str(index))
            self.bridge.ledger.register(task)
            self.enqueue("completed", 1, "Done", task_id=task)
            await self.drain()
        self.assertEqual(len(self.agent.chat_ctx.items), 8)


if __name__ == "__main__":
    unittest.main()
