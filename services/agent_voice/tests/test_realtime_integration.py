"""Exercise the installed provider/voice SDK with an in-memory websocket."""

import asyncio
import base64
import json
import time
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

import aiohttp
from livekit.agents import AgentSession
from livekit.agents.voice import io
from livekit.plugins.openai.realtime.realtime_model import RealtimeSession

from agent import MacroVoiceAgent, provider_tool_name
from protocol import VoiceJob
from runtime import NativeRuntime
from test_protocol import job_data
from test_runtime import configuration
from worker import create_model


class ProviderSocket:
    def __init__(self):
        self.incoming = asyncio.Queue()
        self.sent = []
        self.closed = False
        self.previous_item = None

    def emit(self, **event):
        self.incoming.put_nowait(SimpleNamespace(type=aiohttp.WSMsgType.TEXT, data=json.dumps(event)))

    async def receive(self):
        return await self.incoming.get()

    async def send_str(self, raw):
        event = json.loads(raw)
        self.sent.append(event)
        if event["type"] == "conversation.item.create":
            self.item(event["item"], previous=event.get("previous_item_id"))
        elif event["type"] == "conversation.item.delete":
            self.emit(type="conversation.item.deleted", event_id="deleted", item_id=event["item_id"])

    async def close(self):
        self.closed = True

    def item(self, item, previous=None):
        self.emit(type="conversation.item.added", event_id="item-added", item=item,
                  previous_item_id=None if previous == "root" else previous or self.previous_item)
        self.previous_item = item["id"]

    def input(self, item_id, text):
        self.emit(type="input_audio_buffer.speech_started", event_id="speech-start", item_id=item_id, audio_start_ms=0)
        self.emit(type="input_audio_buffer.speech_stopped", event_id="speech-stop", item_id=item_id, audio_end_ms=100)
        self.emit(type="input_audio_buffer.committed", event_id="committed", item_id=item_id, previous_item_id=self.previous_item)
        self.item({"id": item_id, "type": "message", "role": "user", "content": [{"type": "input_audio", "transcript": None}]})
        self.emit(type="conversation.item.input_audio_transcription.completed", event_id="transcribed",
                  item_id=item_id, content_index=0, transcript=text, logprobs=None, usage={"type": "duration", "seconds": 0.1})

    def response(self, response_id, *, text=None, tool=None, metadata=None, done=True):
        response = {"id": response_id, "object": "realtime.response", "status": "in_progress", "output": [],
                    "metadata": metadata, "usage": None}
        self.emit(type="response.created", event_id="response-created", response=response)
        item_id = response_id + "-item"
        if tool:
            item = {"id": item_id, "type": "function_call", "call_id": tool["call_id"],
                    "name": tool["name"], "arguments": json.dumps(tool["arguments"]), "status": "completed"}
        else:
            item = {"id": item_id, "type": "message", "role": "assistant", "status": "in_progress", "content": []}
        self.item(item)
        self.emit(type="response.output_item.added", event_id="output-item", response_id=response_id, output_index=0, item=item)
        if text is not None:
            self.emit(type="response.content_part.added", event_id="part", response_id=response_id, output_index=0,
                      item_id=item_id, content_index=0, part={"type": "audio", "transcript": ""})
            self.emit(type="response.output_audio_transcript.delta", event_id="transcript", response_id=response_id,
                      item_id=item_id, output_index=0, content_index=0, delta=text)
            self.emit(type="response.output_audio.delta", event_id="audio", response_id=response_id,
                      item_id=item_id, output_index=0, content_index=0, delta=base64.b64encode(bytes(9600)).decode())
        if done:
            self.emit(type="response.output_item.done", event_id="item-done", response_id=response_id, output_index=0, item=item)
            self.done(response_id)

    def done(self, response_id, *, cancelled=False):
        self.emit(type="response.done", event_id="response-done", response={
            "id": response_id, "object": "realtime.response", "status": "cancelled" if cancelled else "completed",
            "status_details": None, "output": [], "usage": None, "metadata": None,
        })


class Playback(io.AudioOutput):
    def __init__(self):
        super().__init__(label="offline-playback", capabilities=io.AudioOutputCapabilities(pause=False))
        self.captured = asyncio.Event()
        self.auto_play = True
        self.heard = "Heard prefix"
        self.pending = False

    async def capture_frame(self, frame):
        await super().capture_frame(frame)
        self.pending = True
        self.on_playback_started(created_at=time.time())
        self.captured.set()

    def flush(self):
        super().flush()
        if self.auto_play and self.pending:
            self.pending = False
            self.on_playback_finished(playback_position=0.2, interrupted=False)

    def clear_buffer(self):
        super().flush()
        if self.pending:
            self.pending = False
            self.on_playback_finished(playback_position=0.05, interrupted=True, synchronized_transcript=self.heard)


class RealtimeIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.provider = ProviderSocket()
        self.socket_patch = patch.object(RealtimeSession, "_create_ws_conn", new=AsyncMock(return_value=self.provider))
        self.socket_patch.start()
        self.sent = []
        self.failures = []

        async def send(payload):
            self.sent.append(payload)
            if payload["type"] == "nativeTurn":
                await self.runtime.receive({"type": "nativeTurnAccepted", "actionId": payload["actionId"]})

        self.runtime = NativeRuntime(VoiceJob.parse(json.dumps(job_data())), configuration(tools=[{
            "name": "ReadDocument", "description": "Read a document", "parameters": {
                "type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"],
            },
        }]), send, self.failures.append)
        self.model = create_model("offline-placeholder-not-a-credential", "marin", observer=self.runtime.provider_event)
        self.session = AgentSession(llm=self.model, turn_handling={"turn_detection": "realtime_llm", "interruption": {"enabled": True}})
        self.playback = Playback()
        self.session.output.audio = self.playback
        self.agent = MacroVoiceAgent(self.runtime)
        self.runtime.bind(self.agent, self.session)
        self.runtime.spawn(self.runtime._run_turns())
        await asyncio.wait_for(self.session.start(self.agent, record=False), timeout=2)
        self.runtime.started()

    async def asyncTearDown(self):
        await self.runtime.close()
        await asyncio.wait_for(self.session.aclose(), timeout=3)
        await self.model.aclose()
        self.socket_patch.stop()
        self.assertFalse(self.failures)

    async def until(self, predicate):
        async def wait():
            while not predicate():
                await asyncio.sleep(0.01)
        await asyncio.wait_for(wait(), timeout=3)

    def completions(self):
        return [frame for frame in self.sent if "stopReason" in frame.get("result", {})]

    def updates(self):
        return [frame["params"]["update"] for frame in self.sent if frame.get("method") == "session/update"]

    async def test_actual_provider_emitter_and_native_speech_reach_one_canonical_turn(self):
        self.provider.input("user-1", "Hello")
        self.provider.response("response-1", text="Hello from Macro")
        await self.until(lambda: self.completions())
        self.assertEqual(len(self.updates()), 1)
        self.assertEqual(self.updates()[0]["content"]["text"], "Hello from Macro")
        self.assertEqual(self.completions()[0]["result"]["stopReason"], "end_turn")
        self.assertFalse(any(event["type"] == "response.create" for event in self.provider.sent))

    async def test_actual_text_prompt_uses_same_realtime_socket(self):
        await self.runtime.receive({"type": "acp", "jsonrpc": "2.0", "id": "typed-action", "method": "session/prompt",
                                    "params": {"prompt": [{"type": "text", "text": "Typed request"}]}})
        await self.until(lambda: any(event["type"] == "response.create" for event in self.provider.sent))
        create = next(event for event in self.provider.sent if event["type"] == "response.create")
        self.provider.response("typed-response", text="Typed answer", metadata=create["response"]["metadata"])
        await self.until(lambda: self.completions())
        self.assertEqual(self.completions()[0]["id"], "typed-action")
        self.assertFalse(any(frame["type"] == "nativeTurn" for frame in self.sent))
        self.assertEqual(self.updates()[0]["content"]["text"], "Typed answer")

    async def test_actual_tool_execution_restores_result_and_generates_followup(self):
        self.provider.input("user-1", "Read a document")
        self.provider.response("tool-response", tool={"call_id": "call-1", "name": "ReadDocument", "arguments": {"id": "doc"}})
        await self.until(lambda: any(frame["type"] == "toolCall" for frame in self.sent))
        await self.runtime.receive({"type": "toolResult", "callId": "call-1", "output": {"text": "Actual document"}, "isError": False})
        await self.until(lambda: any(event["type"] == "response.create" for event in self.provider.sent))
        creates = [event for event in self.provider.sent if event["type"] == "conversation.item.create"]
        self.assertTrue(any(event["item"]["type"] == "function_call_output" and "Actual document" in event["item"]["output"] for event in creates))
        followup = next(event for event in self.provider.sent if event["type"] == "response.create")
        self.provider.response("tool-followup", text="The document says this", metadata=followup["response"]["metadata"])
        await self.until(lambda: self.completions())
        self.assertEqual(len(self.completions()), 1)
        self.assertEqual(self.updates()[0]["content"]["text"], "The document says this")

    async def test_actual_barge_in_commits_only_played_prefix_and_provider_truncation(self):
        self.playback.auto_play = False
        self.provider.input("user-1", "Tell me a story")
        self.provider.response("long-response", text="Heard prefix followed by unheard words", done=False)
        await asyncio.wait_for(self.playback.captured.wait(), timeout=2)
        self.provider.emit(type="input_audio_buffer.speech_started", event_id="interrupt", item_id="user-2", audio_start_ms=200)
        self.provider.done("long-response", cancelled=True)
        await self.until(lambda: self.completions())
        self.assertEqual(self.completions()[0]["result"]["stopReason"], "cancelled")
        self.assertEqual(self.updates()[0]["content"]["text"], "Heard prefix")
        await self.until(lambda: any(event["type"] == "conversation.item.truncate" for event in self.provider.sent))
        self.assertNotIn("unheard words", json.dumps(self.sent))

    async def test_interrupted_pending_tool_does_not_stall_next_native_turn(self):
        await self.agent.load_tools([{"name": "calendar/read", "description": "Read the calendar",
                                     "parameters": {"type": "object", "properties": {"id": {"type": "string"}}}}])
        self.provider.input("user-1", "Read a document")
        self.provider.response("pending-tool", tool={"call_id": "call-1", "name": provider_tool_name("calendar/read"), "arguments": {"id": "doc"}})
        await self.until(lambda: any(frame["type"] == "toolCall" for frame in self.sent))
        call = next(frame for frame in self.sent if frame["type"] == "toolCall")
        self.assertEqual(call["name"], "calendar/read")
        self.provider.input("user-2", "Instead, tell me what you heard")
        self.provider.response("next-response", text="I heard your correction")
        # Canonical cancellation must release the old turn before the pending
        # tool returns. Waiting for its result would deadlock a permission UI.
        await self.until(lambda: len(self.completions()) == 2)
        self.assertEqual(self.completions()[0]["result"]["stopReason"], "cancelled")
        await self.runtime.receive({"type": "toolResult", "callId": "call-1", "output": {"text": "Late document"}, "isError": False})
        await self.until(lambda: any(event["type"] == "conversation.item.create"
                                   and event["item"]["type"] == "function_call_output"
                                   and "Late document" in event["item"]["output"] for event in self.provider.sent))
        self.assertFalse(any(event["type"] == "response.create" for event in self.provider.sent))

    async def test_provider_transport_reconnect_keeps_same_voice_session_and_observer(self):
        errors, closed = [], []
        self.session.on("error", lambda event: errors.append(event.error))
        self.session.on("close", closed.append)
        self.provider.incoming.put_nowait(SimpleNamespace(type=aiohttp.WSMsgType.CLOSED))
        await self.until(lambda: errors)
        self.assertTrue(all(error.recoverable for error in errors))
        await self.until(lambda: self.socket_patch.target._create_ws_conn.await_count >= 2)
        self.provider.input("after-reconnect", "Are you still there")
        self.provider.response("reconnected-response", text="Still here")
        await self.until(lambda: self.completions())
        self.assertEqual(self.updates()[0]["content"]["text"], "Still here")
        self.assertFalse(closed)


if __name__ == "__main__":
    unittest.main()
