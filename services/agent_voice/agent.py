"""The Macro harness, speaking directly through a native realtime model."""

import asyncio
import hashlib
import re

from livekit.agents import Agent, RunContext, function_tool, llm
from livekit.plugins import openai

from runtime import NativeRuntime, validate_tool

VOICE_INSTRUCTIONS = """You are speaking with the user in their existing Macro agent
conversation. Use your Macro tools directly. Be warm, direct, and concise; leave
room for the user to interrupt. Prefer one or two spoken sentences at a time.
Do not read Markdown, code blocks, URLs, or tool internals aloud. Keep detailed
artifacts in Macro. Match the user's language.

When a tool needs permission or a structured answer, explain briefly that the
user should use the review controls in the conversation. Spoken agreement is
not approval. Do not invent a successful outcome before a tool confirms it.
An interruption stops your speech; it does not undo an action already taken.
Use confirmed tool results when discussing what happened.
"""


def provider_tool_name(name: str) -> str:
    if re.fullmatch(r"[A-Za-z0-9_-]{1,64}", name):
        return name
    prefix = re.sub(r"[^A-Za-z0-9_-]", "_", name)[:45]
    return f"{prefix}_{hashlib.sha256(name.encode()).hexdigest()[:16]}"


class NativeRealtimeModel(openai.realtime.RealtimeModel):
    def __init__(self, *, observer, **options):
        super().__init__(**options)
        self._observer = observer

    def session(self):
        session = super().session()
        # Attach before the websocket receive task can process provider events.
        session.on("openai_server_event_received", self._observer)
        return session


class MacroVoiceAgent(Agent):
    def __init__(self, runtime: NativeRuntime):
        self.runtime = runtime
        self._schemas = {}
        self._tool_lock = asyncio.Lock()
        for tool in runtime.configuration["tools"]:
            validate_tool(tool)
            self._schemas[tool["name"]] = tool
        chat = llm.ChatContext()
        for message in runtime.configuration.get("history", []):
            chat.add_message(role=message["role"], content=message["text"])
        super().__init__(
            instructions=runtime.configuration["instructions"] + "\n\n" + VOICE_INSTRUCTIONS,
            chat_ctx=chat, tools=self._function_tools(),
        )

    def _function_tools(self):
        result = []
        for name, schema in self._schemas.items():
            def make_tool(tool_name):
                async def execute(raw_arguments: dict, context: RunContext):
                    return await self.runtime.execute_tool(context, tool_name, raw_arguments)
                return execute

            result.append(function_tool(make_tool(name), raw_schema={
                "name": provider_tool_name(name),
                "description": schema.get("description", "") + (
                    f"\nOriginal tool name: {name}" if provider_tool_name(name) != name else ""
                ),
                "parameters": schema["parameters"],
            }))
        return result

    async def load_tools(self, tools: list[dict]) -> None:
        async with self._tool_lock:
            for tool in tools:
                validate_tool(tool)
                self._schemas[tool["name"]] = tool
            await self.update_tools(self._function_tools())
