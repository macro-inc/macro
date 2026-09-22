"""No-network contracts against the pinned SDK and async result scheduling."""

import asyncio
import json
import unittest
from unittest.mock import patch
from unittest.mock import AsyncMock, Mock
from types import SimpleNamespace
from datetime import datetime, timedelta, timezone

from livekit import rtc
from livekit.agents import AgentSession, room_io

from agent import MacroVoiceAgent
from test_protocol import job_data
from test_config import configured_environment
from worker import create_model, entrypoint, worker_options


class SdkTests(unittest.IsolatedAsyncioTestCase):
    async def test_worker_options_use_the_existing_backend_url(self):
        with patch.dict("os.environ", configured_environment(), clear=True):
            options = worker_options(validate=True)
        self.assertEqual(options.ws_url, "wss://macro.invalid/")
        self.assertEqual(options.agent_name, "macro-agent-voice-prod")
        self.assertEqual(options.drain_timeout, 110)

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
                text_output=True, close_on_disconnect=False, delete_room_on_close=False,
            )
            self.assertEqual(options.participant_identity, "expected-user")
            self.assertFalse(options.text_input)
            self.assertFalse(options.delete_room_on_close)
            await session.aclose()
        finally:
            await model.aclose()


class StartupTests(unittest.IsolatedAsyncioTestCase):
    async def exercise_startup(self, *, startup_error=None, on_reply=None, on_tick=None,
                               attribute_error=None, data_error=None, expired=False):
        metadata = job_data()
        calls = []

        async def mark_attributes(attributes):
            calls.append(("attributes", attributes))
            if "macro.voice.status" in attributes and attribute_error:
                raise attribute_error

        async def publish(payload, **_options):
            calls.append(("data", json.loads(payload)))
            if json.loads(payload)["type"] == "ready":
                reply()
            if json.loads(payload)["type"] != "ready" and data_error:
                raise data_error

        participant = SimpleNamespace(
            set_attributes=AsyncMock(side_effect=mark_attributes),
            publish_data=AsyncMock(side_effect=publish),
            perform_rpc=AsyncMock(return_value=json.dumps({
                "version": 1, "sessionId": metadata["sessionId"], "messages": [],
            })),
        )
        room = SimpleNamespace(
            name="voice-room-1",
            local_participant=participant,
            remote_participants={metadata["participantIdentity"]: object()},
            connection_state=rtc.ConnectionState.CONN_CONNECTED,
            on=lambda _event: lambda callback: callback,
        )
        context = SimpleNamespace(
            job=SimpleNamespace(metadata=json.dumps(metadata)), room=room,
            proc=SimpleNamespace(userdata={"vad": None}),
            connect=AsyncMock(), wait_for_participant=AsyncMock(), shutdown=Mock(),
            delete_room=AsyncMock(side_effect=lambda: calls.append(("delete_room", None))),
        )
        callbacks = {}

        def subscribe(event):
            def register(callback):
                callbacks[event] = callback
                return callback
            return register

        async def start(**_options):
            calls.append(("start", None))
            self.assertFalse(_options["room_options"].delete_room_on_close)
            if startup_error:
                raise startup_error

        def reply(**_options):
            if on_reply:
                on_reply(callbacks, room)
            elif on_tick is None and not expired:
                callbacks["close"](None)

        ticks = 0

        def tick():
            nonlocal ticks
            now = on_tick(ticks, callbacks, room) if on_tick else ticks
            ticks += 1
            return now

        session = SimpleNamespace(
            on=subscribe, start=AsyncMock(side_effect=start), aclose=AsyncMock(),
            generate_reply=reply,
        )
        initialized = asyncio.Event()
        initialized.set()
        runtime = SimpleNamespace(
            bind=Mock(), provider_event=Mock(), started=Mock(),
            initialized=initialized, close=AsyncMock(),
        )
        with patch.dict("os.environ", configured_environment(), clear=True), \
             patch("worker.AgentSession", return_value=session), \
             patch("worker.NativeRuntime.connect", new=AsyncMock(return_value=runtime)), \
             patch("worker.MacroVoiceAgent", return_value=object()), \
             patch("worker.create_model", return_value=object()), \
             patch("worker.monotonic", side_effect=tick), \
             patch("worker.datetime") as clock:
            clock.now.return_value = datetime.now(timezone.utc) + timedelta(minutes=31 if expired else 0)
            with self.assertLogs("macro-agent-voice", level="INFO") as logs:
                await asyncio.wait_for(entrypoint(context), timeout=6)
        context.shutdown.assert_called_once()
        session.aclose.assert_awaited_once()
        context.delete_room.assert_awaited_once()
        return metadata, calls, logs

    def terminal_status(self, calls):
        return next(json.loads(value["macro.voice.status"])
                    for kind, value in calls
                    if kind == "attributes" and "macro.voice.status" in value)

    async def test_durable_ready_is_published_after_start_and_before_data_ready(self):
        metadata, calls, _logs = await self.exercise_startup()
        self.assertEqual(calls[:3], [
            ("start", None),
            ("attributes", {"macro.voice.ready": metadata["voiceSessionId"]}),
            ("data", {"version": 1, "type": "ready"}),
        ])

    async def test_failed_start_never_marks_ready_and_logs_only_safe_error_type(self):
        _metadata, calls, logs = await self.exercise_startup(startup_error=RuntimeError("sensitive-provider-value"))
        self.assertFalse(any(kind == "attributes" and value.get("macro.voice.ready") for kind, value in calls))
        self.assertFalse(any(kind == "data" and value["type"] == "ready" for kind, value in calls))
        self.assertTrue(any(kind == "data" and value["type"] == "error" for kind, value in calls))
        failed = next(record for record in logs.records if record.getMessage() == "Voice session failed")
        self.assertEqual(failed.error_type, "RuntimeError")
        self.assertEqual(failed.stage, "starting_session")
        self.assertNotIn("sensitive-provider-value", str(failed.__dict__))

    async def test_terminal_reason_survives_packet_loss_and_precedes_room_deletion(self):
        metadata, calls, _logs = await self.exercise_startup(data_error=RuntimeError("offline"))
        status = self.terminal_status(calls)
        self.assertEqual(status["voiceSessionId"], metadata["voiceSessionId"])
        self.assertEqual(status["type"], "ended")
        self.assertEqual(calls[-3][0], "attributes")
        self.assertEqual(calls[-3][1]["macro.voice.ready"], "")
        self.assertEqual(calls[-2][0], "data")
        self.assertEqual(calls[-1][0], "delete_room")

    async def test_attribute_failure_still_attempts_terminal_packet_and_cleanup(self):
        _metadata, calls, _logs = await self.exercise_startup(attribute_error=RuntimeError("offline"))
        self.assertEqual(calls[-2][1]["type"], "ended")
        self.assertEqual(calls[-1][0], "delete_room")

    async def test_fatal_error_and_simultaneous_close_preserve_error_reason(self):
        def fatal(callbacks, _room):
            callbacks["error"](SimpleNamespace(error=SimpleNamespace(recoverable=False)))
            callbacks["close"](None)

        _metadata, calls, _logs = await self.exercise_startup(on_reply=fatal)
        status = self.terminal_status(calls)
        self.assertEqual(status["type"], "error")
        self.assertIn("work is still available", status["message"])

    async def test_recoverable_provider_error_keeps_session_open(self):
        def recovering(callbacks, _room):
            callbacks["error"](SimpleNamespace(error=SimpleNamespace(recoverable=True)))

        def tick(index, callbacks, _room):
            self.assertEqual(index, 0)
            callbacks["close"](None)
            return 0

        _metadata, calls, logs = await self.exercise_startup(on_reply=recovering, on_tick=tick)
        self.assertEqual(self.terminal_status(calls)["type"], "ended")
        self.assertTrue(any(record.getMessage() == "Voice provider is recovering" for record in logs.records))

    async def test_connected_silence_does_not_end_voice(self):
        def tick(index, callbacks, _room):
            if index == 1:
                callbacks["close"](None)
            return [0, 1000][index]

        _metadata, calls, _logs = await self.exercise_startup(on_tick=tick)
        self.assertNotIn("without speech", self.terminal_status(calls)["message"])
        self.assertIn("connection ended", self.terminal_status(calls)["message"])

    async def test_absent_caller_gets_full_reconnect_grace(self):
        def tick(index, _callbacks, room):
            room.remote_participants.clear()
            return [0, 119, 120][index]

        _metadata, calls, _logs = await self.exercise_startup(on_tick=tick)
        self.assertIn("did not reconnect", self.terminal_status(calls)["message"])

    async def test_worker_reconnect_resets_unreliable_caller_absence(self):
        def tick(index, callbacks, room):
            room.remote_participants.clear()
            room.connection_state = (rtc.ConnectionState.CONN_RECONNECTING if index == 1
                                     else rtc.ConnectionState.CONN_CONNECTED)
            if index == 3:
                callbacks["close"](None)
            return [0, 200, 300, 419][index]

        _metadata, calls, _logs = await self.exercise_startup(on_tick=tick)
        self.assertIn("connection ended", self.terminal_status(calls)["message"])

    async def test_returning_caller_resets_absence_grace(self):
        def tick(index, callbacks, room):
            if index == 1:
                room.remote_participants["voice-user-1"] = object()
            else:
                room.remote_participants.clear()
            if index == 3:
                callbacks["close"](None)
            return [0, 100, 150, 269][index]

        _metadata, calls, _logs = await self.exercise_startup(on_tick=tick)
        self.assertIn("connection ended", self.terminal_status(calls)["message"])

    async def test_absolute_session_expiry_still_ends_connected_voice(self):
        _metadata, calls, _logs = await self.exercise_startup(expired=True)
        self.assertIn("time limit", self.terminal_status(calls)["message"])


if __name__ == "__main__":
    unittest.main()
