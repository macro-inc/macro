"""NativeRuntime client for the Rust socket integration fixture; no provider calls."""

import asyncio
import json
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from livekit.agents import llm

from protocol import VoiceJob
from runtime import NativeRuntime
from test_runtime import Speech


async def main():
    job = VoiceJob.parse(sys.argv[1])
    failures = []
    runtime = await NativeRuntime.connect(
        job, "agent-voice-" + job.voice_session_id,
        "socket-test-key", "socket-test-secret-at-least-32-characters",
        failures.append,
    )
    try:
        await asyncio.wait_for(runtime.initialized.wait(), timeout=5)
        speech = Speech("socket-smoke")
        runtime.provider_event({"type": "input_audio_buffer.committed", "item_id": "audio-1"})
        runtime.speech_created(SimpleNamespace(user_initiated=False, speech_handle=speech))
        runtime.provider_event({"type": "conversation.item.input_audio_transcription.completed",
                                "item_id": "audio-1", "transcript": "Read my document"})
        context = SimpleNamespace(speech_handle=speech, function_call=llm.FunctionCall(
            call_id="read-1", name="ReadDocument", arguments="{}"))
        result = await asyncio.wait_for(runtime.execute_tool(context, "ReadDocument", {}), timeout=5)
        assert result["committed"] is True
        speech.finish("The document was read.")
        await asyncio.wait_for(runtime._turn_queue.join(), timeout=5)
        assert not failures, failures
        print("native runtime socket passed")
    finally:
        await runtime.close()


if __name__ == "__main__":
    asyncio.run(main())
