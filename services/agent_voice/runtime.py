"""One native voice runtime attached to Macro's canonical ACP session."""

import asyncio
from collections import deque
from dataclasses import dataclass, field
from datetime import timedelta
import json
import logging
from typing import Awaitable, Callable
from urllib.parse import urlsplit, urlunsplit
from uuid import UUID, uuid5

import aiohttp
from livekit import api
from livekit.agents import llm

from protocol import VoiceJob

logger = logging.getLogger("macro-agent-voice")
MAX_RUNTIME_MESSAGE_BYTES = 4 * 1024 * 1024


class RuntimeDisconnected(Exception):
    """The durable runtime connection is unavailable; never replay tool calls."""


def runtime_url(value: str) -> str:
    parsed = urlsplit(value)
    scheme = {"http": "ws", "https": "wss", "ws": "ws", "wss": "wss"}.get(parsed.scheme)
    if not scheme or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("invalid voice runtime URL")
    return urlunsplit(parsed._replace(scheme=scheme))


def runtime_token(job: VoiceJob, room: str, key: str, secret: str) -> str:
    return (api.AccessToken(key, secret)
            .with_identity(job.agent_identity)
            .with_ttl(timedelta(minutes=2))
            .with_grants(api.VideoGrants(room_join=True, room=room))
            .to_jwt())


def validate_configuration(payload: dict) -> dict:
    if payload.get("type") != "configure" or not isinstance(payload.get("sessionId"), str):
        raise ValueError("missing native voice configuration")
    if not isinstance(payload.get("instructions"), str) or not isinstance(payload.get("tools"), list):
        raise ValueError("invalid native voice configuration")
    history = payload.get("history", [])
    if not isinstance(history, list) or any(
        not isinstance(item, dict) or item.get("role") not in {"user", "assistant"}
        or not isinstance(item.get("text"), str) for item in history
    ):
        raise ValueError("invalid native voice history")
    for tool in payload["tools"]:
        validate_tool(tool)
    return payload


def validate_tool(tool: dict) -> None:
    if (not isinstance(tool, dict) or not isinstance(tool.get("name"), str)
            or not tool["name"] or not isinstance(tool.get("description", ""), str)
            or not isinstance(tool.get("parameters"), dict)):
        raise ValueError("invalid native tool schema")


@dataclass
class VoiceTurn:
    action_id: str
    native: bool
    transcript: str | None = None
    accepted: asyncio.Event = field(default_factory=asyncio.Event)
    changed: asyncio.Event = field(default_factory=asyncio.Event)
    updates: deque = field(default_factory=deque)
    message_ids: set[str] = field(default_factory=set)
    speech: object | None = None
    speech_done: bool = False
    interrupted: bool = False
    completed: bool = False
    tool_dispatches: list[asyncio.Future] = field(default_factory=list)


class NativeRuntime:
    """Keep provider audio timing independent of durable turn admission.

    Audio may start before final STT. Only canonical output and tool execution
    wait for the server to record and acknowledge the corresponding user turn.
    The server owns tool results and reviews even when speech is interrupted.
    """

    def __init__(self, job: VoiceJob, configuration: dict,
                 send: Callable[[dict], Awaitable[None]], fail: Callable[[str], None]):
        self.job = job
        self.configuration = validate_configuration(configuration)
        self.session_id = configuration["sessionId"]
        self._send = send
        self._fail = fail
        self._send_lock = asyncio.Lock()
        self._http = None
        self._socket = None
        self._tasks: set[asyncio.Task] = set()
        self._closed = False
        self._started = asyncio.Event()
        self.initialized = asyncio.Event()
        self._turn_queue: asyncio.Queue[VoiceTurn] = asyncio.Queue(maxsize=128)
        self._audio_turns: dict[str, VoiceTurn] = {}
        self._current_audio_turn: VoiceTurn | None = None
        self._starting_text_turn: VoiceTurn | None = None
        self._speeches: dict[str, VoiceTurn] = {}
        self._admissions: dict[str, asyncio.Future] = {}
        self._tool_results: dict[str, asyncio.Future] = {}
        self._tool_runs: dict[str, tuple[str, asyncio.Task]] = {}
        self._context_lock = asyncio.Lock()
        self._usage: dict[str, dict] = {}
        self.agent = None
        self.session = None

    @classmethod
    async def connect(cls, job: VoiceJob, room: str, key: str, secret: str,
                      fail: Callable[[str], None]) -> "NativeRuntime":
        http = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=None, connect=15))
        try:
            socket = await http.ws_connect(
                runtime_url(job.runtime_url),
                headers={"Authorization": "Bearer " + runtime_token(job, room, key, secret)},
                heartbeat=20, max_msg_size=MAX_RUNTIME_MESSAGE_BYTES,
            )
            configuration = await socket.receive_json(timeout=20)
            runtime = cls(job, configuration, socket.send_json, fail)
            runtime._http, runtime._socket = http, socket
            runtime.spawn(runtime._read())
            runtime.spawn(runtime._run_turns())
            await runtime.send({"type": "event", "event": "acp_ready"})
            return runtime
        except BaseException:
            await http.close()
            raise

    def spawn(self, coroutine) -> asyncio.Task:
        task = asyncio.create_task(coroutine)
        self._tasks.add(task)

        def done(completed):
            self._tasks.discard(completed)
            if not completed.cancelled() and (error := completed.exception()) is not None:
                logger.error("Native voice runtime failed", extra={
                    "voice_session_id": self.job.voice_session_id,
                    "error_type": type(error).__name__,
                })
                self._fail("Voice lost its agent connection. Continue in text or reopen voice.")

        task.add_done_callback(done)
        return task

    async def send(self, payload: dict) -> None:
        if self._closed:
            raise RuntimeDisconnected()
        async with self._send_lock:
            await self._send(payload)

    async def _read(self) -> None:
        async for packet in self._socket:
            if packet.type == aiohttp.WSMsgType.TEXT:
                await self.receive(json.loads(packet.data))
            elif packet.type == aiohttp.WSMsgType.ERROR:
                raise RuntimeDisconnected()
        if not self._closed:
            raise RuntimeDisconnected()

    async def receive(self, payload: dict) -> None:
        kind = payload.get("type")
        if kind in {"nativeTurnAccepted", "nativeTurnRejected"}:
            future = self._admissions.get(payload.get("actionId"))
            if future and not future.done():
                future.set_result(payload)
        elif kind == "toolResult":
            future = self._tool_results.get(payload.get("callId"))
            if future and not future.done():
                future.set_result(payload)
        elif kind == "acp":
            await self._acp(payload)
        elif kind == "tools":
            await self.agent.load_tools(payload.get("tools", []))
        elif kind == "error":
            raise RuntimeDisconnected()

    async def response(self, request_id, result: dict) -> None:
        await self.send({"type": "acp", "jsonrpc": "2.0", "id": request_id, "result": result})

    async def _acp(self, request: dict) -> None:
        method, request_id = request.get("method"), request.get("id")
        params = request.get("params", {})
        if method == "initialize":
            await self.response(request_id, {
                "protocolVersion": 1,
                "agentCapabilities": {
                    "loadSession": True,
                    "promptCapabilities": {"embeddedContext": True},
                    "sessionCapabilities": {"resume": {}},
                },
                "agentInfo": {"name": "macro-voice", "version": "1"},
            })
        elif method in {"session/new", "session/resume", "session/load"}:
            await self.response(request_id, {"sessionId": self.session_id})
            self.initialized.set()
        elif method == "session/prompt":
            turn = VoiceTurn(str(request_id), native=False)
            turn.transcript = prompt_text(params.get("prompt", []))
            turn.accepted.set()  # The server logged text prompts before sending.
            self._turn_queue.put_nowait(turn)
            self.spawn(self._text_prompt(turn))
        elif method == "session/cancel":
            if self.session is not None:
                self.session.interrupt(force=True)
            if request_id is not None:
                await self.response(request_id, {})
        elif method and request_id is not None:
            await self.send({"type": "acp", "jsonrpc": "2.0", "id": request_id,
                             "error": {"code": -32601, "message": "Unsupported voice runtime method"}})

    def bind(self, agent, session) -> None:
        self.agent, self.session = agent, session
        session.on("speech_created", self.speech_created)
        session.on("conversation_item_added", self.conversation_item_added)

    def started(self) -> None:
        self._started.set()

    async def _text_prompt(self, turn: VoiceTurn) -> None:
        await self._started.wait()
        self._starting_text_turn = turn
        try:
            self.session.generate_reply(user_input=turn.transcript, allow_interruptions=True)
        finally:
            self._starting_text_turn = None

    def _audio_turn(self, item_id: str) -> VoiceTurn:
        if item_id not in self._audio_turns:
            if len(self._audio_turns) >= 512:
                raise ValueError("voice turn limit exceeded")
            turn = VoiceTurn(str(uuid5(UUID(self.job.voice_session_id), item_id)), native=True)
            self._audio_turns[item_id] = turn
            self._turn_queue.put_nowait(turn)
        return self._audio_turns[item_id]

    def provider_event(self, event: dict) -> None:
        """Observe identifiers, never publish speculative/unheard transcript deltas."""
        kind = event.get("type")
        if kind == "input_audio_buffer.committed":
            self._current_audio_turn = self._audio_turn(event["item_id"])
        elif kind == "conversation.item.input_audio_transcription.completed":
            turn = self._audio_turn(event["item_id"])
            turn.transcript = event.get("transcript", "").strip()
            turn.changed.set()
        elif kind == "conversation.item.input_audio_transcription.failed":
            turn = self._audio_turn(event["item_id"])
            turn.transcript = ""
            turn.changed.set()
            logger.warning("Native voice turn had no usable transcript", extra={"voice_session_id": self.job.voice_session_id})

    def speech_created(self, event) -> None:
        turn = self._starting_text_turn if event.user_initiated else self._current_audio_turn
        if turn is None:
            self._fail("Voice could not associate its response with this conversation. Please reopen voice.")
            return
        turn.speech = event.speech_handle
        self._speeches[event.speech_handle.id] = turn
        event.speech_handle.add_done_callback(lambda speech: self.speech_done(turn, speech))

    def conversation_item_added(self, event) -> None:
        item = event.item
        if not isinstance(item, llm.ChatMessage):
            return
        if item.role == "user" and item.id in self._audio_turns:
            turn = self._audio_turns[item.id]
            turn.transcript = item.text_content or ""
            turn.changed.set()
        elif item.role == "assistant":
            for turn in self._speeches.values():
                if any(part.id == item.id for part in turn.speech.chat_items):
                    self._heard_message(turn, item)
                    break

    def _heard_message(self, turn: VoiceTurn, item: llm.ChatMessage) -> None:
        if item.id in turn.message_ids or not item.text_content:
            return
        turn.message_ids.add(item.id)
        turn.updates.append({
            "sessionUpdate": "agent_message_chunk",
            "content": {"type": "text", "text": item.text_content},
            "_meta": {"macro.voice": {"itemId": item.id, "interrupted": item.interrupted}},
        })
        turn.changed.set()

    def speech_done(self, turn: VoiceTurn, speech) -> None:
        # The public chat_items contain the playback-synchronized transcript
        # after the SDK has truncated unheard audio on provider interruption.
        for item in speech.chat_items:
            if isinstance(item, llm.ChatMessage) and item.role == "assistant":
                self._heard_message(turn, item)
        turn.interrupted = speech.interrupted
        turn.speech_done = True
        turn.changed.set()

    async def _admit(self, turn: VoiceTurn) -> None:
        while not turn.accepted.is_set():
            future = asyncio.get_running_loop().create_future()
            self._admissions[turn.action_id] = future
            await self.send({"type": "nativeTurn", "actionId": turn.action_id, "text": turn.transcript})
            try:
                result = await asyncio.wait_for(asyncio.shield(future), timeout=15)
            finally:
                self._admissions.pop(turn.action_id, None)
            if result["type"] == "nativeTurnAccepted":
                turn.accepted.set()
            elif result.get("code") == "busy":
                await asyncio.sleep(0.1)
            else:
                raise RuntimeDisconnected()

    async def _run_turns(self) -> None:
        while True:
            turn = await self._turn_queue.get()
            try:
                while turn.transcript is None:
                    turn.changed.clear()
                    await asyncio.wait_for(turn.changed.wait(), timeout=30)
                if turn.native:
                    # Blank transcription is not a user request. Never execute
                    # a model-selected tool without a durable attributed turn.
                    if not turn.transcript.strip():
                        turn.completed = True
                        turn.accepted.set()  # Release waiting calls to report not executed.
                        continue
                    await self._admit(turn)
                while True:
                    turn.changed.clear()
                    while turn.updates:
                        await self.send({"type": "acp", "jsonrpc": "2.0", "method": "session/update",
                                         "params": {"sessionId": self.session_id, "update": turn.updates.popleft()}})
                    if turn.speech_done:
                        # ToolCall must reach the server before the prompt's
                        # final response, including when STT arrived late.
                        await asyncio.gather(*turn.tool_dispatches)
                        await self.response(turn.action_id, {"stopReason": "cancelled" if turn.interrupted else "end_turn"})
                        turn.completed = True
                        break
                    await turn.changed.wait()
            finally:
                self._turn_queue.task_done()

    async def execute_tool(self, context, name: str, arguments: dict):
        call_id = context.function_call.call_id
        turn = self._speeches.get(context.speech_handle.id)
        if turn is None:
            raise ValueError("tool call has no native voice turn")
        fingerprint = json.dumps({"name": name, "arguments": arguments}, sort_keys=True)
        previous = self._tool_runs.get(call_id)
        if previous:
            if previous[0] != fingerprint:
                raise ValueError("conflicting native tool call")
            task = previous[1]
        else:
            if len(self._tool_runs) >= 512:
                raise ValueError("voice tool limit exceeded")
            dispatched = asyncio.get_running_loop().create_future()
            turn.tool_dispatches.append(dispatched)
            task = self.spawn(self._execute_tool(turn, context, name, arguments, dispatched))
            self._tool_runs[call_id] = (fingerprint, task)
        # Audio interruption never abandons ambiguous side effects. The server
        # owns the durable result; this task also restores it to model context.
        return await asyncio.shield(task)

    async def _execute_tool(self, turn, context, name: str, arguments: dict, dispatched):
        call_id = context.function_call.call_id
        try:
            await turn.accepted.wait()
            if context.speech_handle.interrupted or turn.completed:
                return {"error": "The call was interrupted before execution."}
            future = asyncio.get_running_loop().create_future()
            self._tool_results[call_id] = future
            await self.send({"type": "toolCall", "actionId": turn.action_id,
                             "callId": call_id, "name": name, "arguments": arguments})
        finally:
            if not dispatched.done():
                dispatched.set_result(None)
        try:
            result = await future
        finally:
            self._tool_results.pop(call_id, None)
        if result.get("loadedTools"):
            await self.agent.load_tools(result["loadedTools"])
        output = result.get("output")
        if context.speech_handle.interrupted:
            self.spawn(self._restore_tool_result(context, name, output, bool(result.get("isError"))))
        if result.get("isError"):
            return {"error": output}
        return output

    async def _restore_tool_result(self, context, name: str, output, is_error: bool) -> None:
        # SDK interrupted generations skip their normal tool-output insertion.
        # Restore only at a conversation gap; never create another response.
        while self.session.user_state == "speaking" or self.session.agent_state in {"speaking", "thinking"}:
            await asyncio.sleep(0.05)
        async with self._context_lock:
            chat = self.agent.chat_ctx.copy()
            call = context.function_call
            if not any(isinstance(item, llm.FunctionCall) and item.call_id == call.call_id for item in chat.items):
                chat.items.append(call)
            if not any(isinstance(item, llm.FunctionCallOutput) and item.call_id == call.call_id for item in chat.items):
                chat.items.append(llm.FunctionCallOutput(
                    call_id=call.call_id, name=name, output=json.dumps(output), is_error=is_error,
                ))
                await self.agent.update_chat_ctx(chat)

    def record_usage(self, usage) -> None:
        for model in usage.model_usage:
            if not hasattr(model, "input_tokens") or not model.model:
                continue
            # SDK totals already include audio, text, and cached input tokens.
            payload = {"type": "usage", "model": model.model,
                       "inputTokens": model.input_tokens, "outputTokens": model.output_tokens}
            self._usage[model.model] = payload
            self.spawn(self.send(payload))

    async def flush_usage(self) -> None:
        for payload in self._usage.values():
            await self.send(payload)

    async def close(self) -> None:
        try:
            await asyncio.wait_for(self.flush_usage(), timeout=5)
        except Exception as error:
            logger.warning("Voice final usage could not be delivered", extra={"error_type": type(error).__name__})
        self._closed = True
        for task in list(self._tasks):
            task.cancel()
        await asyncio.gather(*list(self._tasks), return_exceptions=True)
        if self._socket:
            await self._socket.close()
        if self._http:
            await self._http.close()


def prompt_text(blocks: list[dict]) -> str:
    parts = []
    for block in blocks:
        if block.get("type") == "text":
            parts.append(block.get("text", ""))
        elif block.get("type") == "resource_link":
            parts.append(f"Attached resource: {block.get('name', '')} ({block.get('uri', '')})")
        elif block.get("type") == "resource":
            resource = block.get("resource", {})
            if isinstance(resource.get("text"), str):
                parts.append(resource["text"])
    return "\n".join(parts)
