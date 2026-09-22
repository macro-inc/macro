"""Native admission, heard history, direct tools, and interruption contracts."""

import asyncio
import json
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock
from unittest.mock import patch

import aiohttp

from livekit import api
from livekit.agents import RunContext, StopResponse, llm
from livekit.agents.llm.tool_context import get_raw_function_info
from livekit.agents.metrics import AgentSessionUsage
from livekit.agents.metrics.usage import LLMModelUsage

from agent import MacroVoiceAgent, provider_tool_name
from protocol import VoiceJob
from runtime import NativeRuntime, runtime_token, runtime_url
from test_protocol import job_data


def configuration(**updates):
    return {"type": "configure", "sessionId": "acp-session", "instructions": "Be Macro.",
            "history": [{"role": "user", "text": "Earlier conversation"}], "tools": [], **updates}


class Speech:
    def __init__(self, identifier):
        self.id = identifier
        self.chat_items = []
        self.interrupted = False
        self.callbacks = []

    def add_done_callback(self, callback):
        self.callbacks.append(callback)

    def finish(self, text="", *, interrupted=False):
        self.interrupted = interrupted
        if text:
            self.chat_items.append(llm.ChatMessage(id=self.id + "-message", role="assistant",
                                                 content=[text], interrupted=interrupted))
        for callback in self.callbacks:
            callback(self)


class RuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.job = VoiceJob.parse(json.dumps(job_data()))
        self.sent = []
        self.failures = []

        async def send(payload):
            self.sent.append(payload)

        self.runtime = NativeRuntime(self.job, configuration(), send, self.failures.append)
        self.agent = MacroVoiceAgent(self.runtime)
        self.session = SimpleNamespace(on=Mock(), user_state="listening", agent_state="listening",
                                       interrupt=Mock(), generate_reply=Mock())
        self.runtime.bind(self.agent, self.session)
        self.runtime.started()
        self.runtime.spawn(self.runtime._run_turns())

    async def asyncTearDown(self):
        await self.runtime.close()
        self.assertFalse(self.failures)

    async def settle(self):
        for _ in range(15):
            await asyncio.sleep(0)

    def audio(self, item_id="input-1", text=None):
        self.runtime.provider_event({"type": "input_audio_buffer.committed", "item_id": item_id})
        speech = Speech(item_id)
        self.runtime.speech_created(SimpleNamespace(user_initiated=False, speech_handle=speech))
        if text is not None:
            self.transcribe(item_id, text)
        return speech

    def transcribe(self, item_id, text):
        self.runtime.provider_event({"type": "conversation.item.input_audio_transcription.completed",
                                     "item_id": item_id, "transcript": text})

    async def accept(self, index=0):
        await self.settle()
        requests = [frame for frame in self.sent if frame["type"] == "nativeTurn"]
        action_id = requests[index]["actionId"]
        await self.runtime.receive({"type": "nativeTurnAccepted", "actionId": action_id})
        await self.settle()
        return action_id

    def context(self, speech, call_id="call-1", name="ReadDocument"):
        return SimpleNamespace(
            speech_handle=speech,
            function_call=llm.FunctionCall(call_id=call_id, name=name, arguments='{"id":"doc"}'),
        )

    async def test_native_audio_is_never_resubmitted_and_heard_text_waits_for_admission(self):
        speech = self.audio()
        self.runtime.provider_event({"type": "response.output_audio_transcript.delta", "delta": "unheard words"})
        speech.finish("Only these words were heard.", interrupted=True)
        await self.settle()
        self.assertFalse(self.sent)
        self.transcribe("input-1", "Please stop there")
        await self.settle()
        self.assertEqual([frame["type"] for frame in self.sent], ["nativeTurn"])
        action = await self.accept()
        self.assertEqual(self.sent[-2]["params"]["update"]["content"]["text"], "Only these words were heard.")
        self.assertEqual(self.sent[-1]["id"], action)
        self.assertEqual(self.sent[-1]["result"], {"stopReason": "cancelled"})
        self.session.generate_reply.assert_not_called()
        self.assertNotIn("unheard words", json.dumps(self.sent))

    async def test_next_native_turn_admits_only_after_previous_prompt_response(self):
        first = self.audio(text="First request")
        first_action = await self.accept()
        second = self.audio("input-2", "New request")
        await self.settle()
        self.assertEqual(sum(frame["type"] == "nativeTurn" for frame in self.sent), 1)
        first.finish("Partial first reply", interrupted=True)
        await self.settle()
        first_response = next(i for i, frame in enumerate(self.sent) if frame.get("id") == first_action)
        second_admission = next(i for i, frame in enumerate(self.sent) if frame.get("text") == "New request")
        self.assertLess(first_response, second_admission)
        await self.accept(1)
        second.finish("New answer")
        await self.settle()

    async def test_busy_admission_retries_same_identity_without_model_replay(self):
        speech = self.audio(text="Read a document")
        await self.settle()
        action = self.sent[-1]["actionId"]
        await self.runtime.receive({"type": "nativeTurnRejected", "actionId": action, "code": "busy"})
        await asyncio.sleep(0.12)
        requests = [frame for frame in self.sent if frame["type"] == "nativeTurn"]
        self.assertEqual(len(requests), 2)
        self.assertEqual(requests[0], requests[1])
        await self.accept()
        speech.finish("Done")
        await self.settle()
        self.session.generate_reply.assert_not_called()

    async def test_tool_waits_for_admission_and_sends_once_when_waiter_is_interrupted(self):
        speech = self.audio(text="Read a document")
        context = self.context(speech)
        waiter = asyncio.create_task(self.runtime.execute_tool(context, "ReadDocument", {"id": "doc"}))
        await self.settle()
        self.assertFalse(any(frame["type"] == "toolCall" for frame in self.sent))
        await self.accept()
        waiter.cancel()
        await asyncio.gather(waiter, return_exceptions=True)
        retry = asyncio.create_task(self.runtime.execute_tool(context, "ReadDocument", {"id": "doc"}))
        await self.settle()
        self.assertEqual(sum(frame["type"] == "toolCall" for frame in self.sent), 1)
        await self.runtime.receive({"type": "toolResult", "callId": "call-1", "output": {"text": "found"}, "isError": False})
        self.assertEqual(await retry, {"text": "found"})
        speech.finish("Found it")
        await self.settle()

    async def test_interrupt_before_admission_never_dispatches_side_effect(self):
        speech = self.audio(text="Send the message")
        waiter = asyncio.create_task(self.runtime.execute_tool(self.context(speech), "SendMessage", {}))
        await self.settle()
        speech.finish(interrupted=True)
        await self.accept()
        with self.assertRaises(StopResponse):
            await waiter
        self.assertFalse(any(frame["type"] == "toolCall" for frame in self.sent))
        self.assertEqual(self.sent[-1]["result"]["stopReason"], "cancelled")

    async def test_interrupted_tool_result_restores_context_without_an_extra_response(self):
        speech = self.audio(text="Read a document")
        await self.accept()
        waiter = asyncio.create_task(self.runtime.execute_tool(self.context(speech), "ReadDocument", {}))
        await self.settle()
        speech.finish(interrupted=True)
        await self.settle()
        self.assertEqual(self.sent[-1]["result"]["stopReason"], "cancelled")
        self.agent.update_chat_ctx = AsyncMock()
        await self.runtime.receive({"type": "toolResult", "callId": "call-1", "output": "actual result", "isError": False})
        with self.assertRaises(StopResponse):
            await waiter
        await self.settle()
        chat = self.agent.update_chat_ctx.call_args.args[0]
        self.assertTrue(any(isinstance(item, llm.FunctionCallOutput) and "actual result" in item.output for item in chat.items))
        self.session.generate_reply.assert_not_called()
        self.assertFalse(any(frame.get("params", {}).get("update", {}).get("sessionUpdate") == "tool_call" for frame in self.sent))

    async def test_text_prompt_uses_same_session_and_native_cancel_interrupts_it(self):
        speech = Speech("text-speech")

        def generate(**options):
            self.assertEqual(options["user_input"], "Typed request")
            self.runtime.speech_created(SimpleNamespace(user_initiated=True, speech_handle=speech))

        self.session.generate_reply.side_effect = generate
        await self.runtime.receive({"type": "acp", "id": "typed-action", "method": "session/prompt",
                                    "params": {"prompt": [{"type": "text", "text": "Typed request"}]}})
        await self.settle()
        await self.runtime.receive({"type": "acp", "method": "session/cancel"})
        self.session.interrupt.assert_called_once_with(force=True)
        speech.finish("Typed reply", interrupted=True)
        await self.settle()
        self.assertFalse(any(frame["type"] == "nativeTurn" for frame in self.sent))
        self.assertEqual(self.sent[-1]["id"], "typed-action")

    async def test_duplicate_heard_message_is_not_emitted_twice(self):
        speech = self.audio(text="Hello")
        await self.accept()
        message = llm.ChatMessage(role="assistant", content=["Hello back"])
        speech.chat_items.append(message)
        self.runtime.conversation_item_added(SimpleNamespace(item=message))
        speech.finish()
        await self.settle()
        updates = [frame for frame in self.sent if frame.get("method") == "session/update"]
        self.assertEqual(len(updates), 1)

    async def test_empty_transcript_does_not_disconnect_or_execute_tools(self):
        speech = self.audio(text="")
        waiter = asyncio.create_task(self.runtime.execute_tool(self.context(speech), "ReadDocument", {}))
        await self.settle()
        self.assertIn("before execution", (await waiter)["error"])
        self.assertFalse(self.sent)
        self.assertFalse(self.failures)
        speech.finish()

    async def test_usage_sends_cumulative_total_including_audio_once(self):
        usage = AgentSessionUsage(model_usage=[LLMModelUsage(
            provider="openai", model="voice-model", input_tokens=70, input_audio_tokens=50,
            input_text_tokens=20, output_tokens=40, output_audio_tokens=30, output_text_tokens=10,
        )])
        self.runtime.record_usage(usage)
        await self.settle()
        self.assertEqual(self.sent[-1], {"type": "usage", "model": "voice-model", "inputTokens": 70, "outputTokens": 40})

    async def test_initialize_and_resume_are_real_acp_handshakes(self):
        await self.runtime.receive({"type": "acp", "id": 1, "method": "initialize"})
        self.assertTrue(self.sent[-1]["result"]["agentCapabilities"]["loadSession"])
        await self.runtime.receive({"type": "acp", "id": 2, "method": "session/resume"})
        self.assertEqual(self.sent[-1]["result"]["sessionId"], "acp-session")
        self.assertTrue(self.runtime.initialized.is_set())


class RuntimeContractTests(unittest.IsolatedAsyncioTestCase):
    async def test_backend_configure_initialize_resume_handshake_over_actual_reader(self):
        incoming = asyncio.Queue()
        sent = []

        class Socket:
            async def receive_json(self, **_options):
                return configuration()

            async def send_json(self, payload):
                sent.append(payload)
                request = None
                if payload.get("event") == "acp_ready":
                    request = {"type": "acp", "jsonrpc": "2.0", "id": 1, "method": "initialize"}
                elif payload.get("id") == 1:
                    request = {"type": "acp", "jsonrpc": "2.0", "id": 2, "method": "session/resume",
                               "params": {"sessionId": "acp-session"}}
                if request:
                    incoming.put_nowait(SimpleNamespace(type=aiohttp.WSMsgType.TEXT, data=json.dumps(request)))

            def __aiter__(self):
                return self

            async def __anext__(self):
                return await incoming.get()

            async def close(self):
                return None

        http = SimpleNamespace(ws_connect=AsyncMock(return_value=Socket()), close=AsyncMock())
        failures = []
        with patch("runtime.aiohttp.ClientSession", return_value=http):
            runtime = await NativeRuntime.connect(VoiceJob.parse(json.dumps(job_data())), "room", "offline-key",
                                                  "offline-secret-value-for-contract-tests", failures.append)
        try:
            await asyncio.wait_for(runtime.initialized.wait(), timeout=1)
            self.assertEqual(sent[0], {"type": "event", "event": "acp_ready"})
            self.assertEqual(sent[-1]["result"], {"sessionId": "acp-session"})
            self.assertFalse(failures)
            self.assertTrue(http.ws_connect.call_args.args[0].startswith("wss://"))
        finally:
            await runtime.close()
        http.close.assert_awaited_once()

    async def test_direct_tool_schema_uses_sdk_raw_arguments_and_preserves_original_name(self):
        runtime = SimpleNamespace(configuration=configuration(tools=[{
            "name": "mcp/calendar/create", "description": "Create an event",
            "parameters": {"type": "object", "properties": {"title": {"type": "string"}}},
        }]), execute_tool=AsyncMock(return_value={"created": True}))
        agent = MacroVoiceAgent(runtime)
        tool = agent.tools[0]
        context = Mock(spec=RunContext)
        self.assertEqual(await tool(raw_arguments={"title": "Meeting"}, context=context), {"created": True})
        runtime.execute_tool.assert_awaited_once_with(context, "mcp/calendar/create", {"title": "Meeting"})
        self.assertEqual(get_raw_function_info(tool).name, provider_tool_name("mcp/calendar/create"))
        self.assertEqual(agent.chat_ctx.items[0].text_content, "Earlier conversation")
        self.assertNotIn("ask_macro", agent.instructions)
        await agent.load_tools([{"name": "ReadFile", "description": "Read", "parameters": {"type": "object"}}])
        self.assertEqual(len(agent.tools), 2)

    async def test_worker_jwt_is_short_lived_and_scoped_to_exact_room_and_identity(self):
        job = VoiceJob.parse(json.dumps(job_data()))
        token = runtime_token(job, "private-room", "offline-key", "offline-secret-value-for-contract-tests")
        claims = api.TokenVerifier("offline-key", "offline-secret-value-for-contract-tests").verify(token)
        self.assertEqual(claims.identity, job.agent_identity)
        self.assertEqual(claims.video.room, "private-room")
        self.assertTrue(claims.video.room_join)
        self.assertFalse(claims.video.room_admin)

    async def test_runtime_url_is_complete_and_rejects_credentials(self):
        self.assertEqual(runtime_url("https://macro.invalid/path/runtime"), "wss://macro.invalid/path/runtime")
        with self.assertRaises(ValueError):
            runtime_url("https://secret@macro.invalid/path/runtime")


if __name__ == "__main__":
    unittest.main()
