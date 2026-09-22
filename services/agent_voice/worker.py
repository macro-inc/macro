"""Private, interruptible LiveKit voice sessions for Macro's agent harness."""

import asyncio
from datetime import datetime, timezone
import json
import logging
import os
import sys
from time import monotonic

from dotenv import load_dotenv
from openai.types import realtime
from livekit import rtc
from livekit.agents import (
    AgentSession,
    AutoSubscribe,
    JobContext,
    JobProcess,
    JobRequest,
    WorkerOptions,
    cli,
    room_io,
)
from livekit.plugins import openai, silero

from agent import MacroVoiceAgent
from bridge import MacroBridge
from config import VoiceConfigurationError, connection_options, credential_present, requires_credentials
from protocol import AGENT_NAME, EVENT_TOPIC, VOICE_TOPIC, TaskEvent, VoiceJob, public_context

logger = logging.getLogger("macro-agent-voice")
load_dotenv()
CALLER_RECONNECT_GRACE_SECONDS = 120


async def request_job(request: JobRequest) -> None:
    try:
        job = VoiceJob.parse(request.job.metadata)
    except (ValueError, TypeError, KeyError) as error:
        logger.warning("Rejecting invalid or expired voice dispatch", extra={"stage": "dispatch_validation", "error_type": type(error).__name__})
        await request.reject()
        return
    await request.accept(
        name="Macro",
        identity=job.agent_identity,
        attributes={"macro.voice.session": job.voice_session_id},
    )
    logger.info("Voice dispatch accepted", extra={"voice_session_id": job.voice_session_id, "stage": "dispatch_accepted"})


def prewarm(proc: JobProcess) -> None:
    proc.userdata["vad"] = silero.VAD.load()


def create_model(api_key: str, voice: str) -> openai.realtime.RealtimeModel:
    """Build provider options without connecting, so the SDK contract is testable."""
    return openai.realtime.RealtimeModel(
        model=os.environ.get("AGENT_VOICE_MODEL", "gpt-realtime-2.1"),
        api_key=api_key,
        voice=voice,
        turn_detection=realtime.realtime_audio_input_turn_detection.SemanticVad(
            type="semantic_vad", eagerness="medium",
            create_response=True, interrupt_response=True,
        ),
        input_audio_transcription=realtime.AudioTranscription(model="gpt-4o-transcribe"),
        input_audio_noise_reduction="near_field",
    )


async def entrypoint(ctx: JobContext) -> None:
    try:
        job = VoiceJob.parse(ctx.job.metadata)
    except (ValueError, TypeError, KeyError) as error:
        logger.warning("Invalid voice job", extra={"stage": "job_validation", "error_type": type(error).__name__})
        ctx.shutdown(reason="invalid voice dispatch")
        return
    shutdown = asyncio.Event()
    background: set[asyncio.Task] = set()
    session: AgentSession | None = None
    bridge: MacroBridge | None = None
    termination: tuple[str, str] | None = None
    room_connected = False
    stage = "job_started"

    def advance(next_stage: str) -> None:
        nonlocal stage
        stage = next_stage
        logger.info("Voice startup progress", extra={"voice_session_id": job.voice_session_id, "stage": stage})

    async def publish(kind: str, message: str | None = None) -> None:
        payload = {"version": 1, "type": kind}
        if message:
            payload["message"] = message
        if kind in {"ended", "error"}:
            try:
                await asyncio.wait_for(ctx.room.local_participant.set_attributes({
                    "macro.voice.ready": "",
                    "macro.voice.status": json.dumps({
                        **payload, "voiceSessionId": job.voice_session_id,
                    }),
                }), timeout=5)
            except Exception as error:
                logger.warning("Voice terminal status could not be persisted", extra={"voice_session_id": job.voice_session_id, "stage": stage, "error_type": type(error).__name__})
        try:
            await asyncio.wait_for(ctx.room.local_participant.publish_data(
                json.dumps(payload), reliable=True,
                destination_identities=[job.participant_identity], topic=VOICE_TOPIC,
            ), timeout=5)
        except Exception as error:
            logger.warning("Voice status could not reach caller", extra={"voice_session_id": job.voice_session_id, "stage": stage, "error_type": type(error).__name__})

    def stop(kind: str, message: str) -> None:
        nonlocal termination
        # Error and close arrive together. Preserve the first explanation and
        # publish it in cleanup, outside the background tasks being cancelled.
        if termination is None:
            termination = (kind, message)
            logger.info("Voice session stopping", extra={"voice_session_id": job.voice_session_id, "stage": stage, "status": kind, "reason": message})
        shutdown.set()

    def spawn(coro) -> None:
        task = asyncio.create_task(coro)
        background.add(task)
        def complete(done: asyncio.Task) -> None:
            background.discard(done)
            if not done.cancelled() and done.exception() is not None:
                logger.error("Voice background task failed", extra={"voice_session_id": job.voice_session_id, "stage": stage, "error_type": type(done.exception()).__name__})
                stop("error", "Voice could not present the agent's response. Its work is still available in text.")
        task.add_done_callback(complete)

    async def rpc(method: str, payload: str) -> str:
        return await ctx.room.local_participant.perform_rpc(
            destination_identity=job.participant_identity,
            method=method, payload=payload, response_timeout=10.0,
        )

    try:
        advance("connecting_room")
        await asyncio.wait_for(ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY), timeout=25)
        room_connected = True
        advance("waiting_for_caller")
        await asyncio.wait_for(ctx.wait_for_participant(identity=job.participant_identity), timeout=25)
        api_key = os.environ.get("OPENAI_API_KEY", "")
        if not credential_present(api_key):
            logger.error("Voice provider is not configured", extra={"voice_session_id": job.voice_session_id, "stage": "provider_configuration"})
            stop("error", "Voice is not configured yet. You can continue in text.")
            return
        bridge = MacroBridge(job, rpc)
        # Context reads may be retried; side-effecting task submissions are not.
        context = None
        advance("loading_context")
        for attempt in range(2):
            try:
                context = public_context(await rpc("macro.voice.context", json.dumps({"version": 1})), job)
                break
            except Exception as error:
                logger.warning("Voice context read failed", extra={"voice_session_id": job.voice_session_id, "stage": stage, "error_type": type(error).__name__, "attempt": attempt + 1})
                if attempt == 0:
                    await asyncio.sleep(0.5)
        if context is None:
            stop("error", "Could not load this agent's conversation. Reopen voice to try again.")
            return

        # Realtime owns semantic endpointing and audio response cancellation.
        # LiveKit tracks playback and truncates unheard audio on interruption;
        # no second application VAD is allowed to submit duplicate user turns.
        advance("configuring_provider")
        model = create_model(api_key, job.voice)
        session = AgentSession(
            llm=model, vad=ctx.proc.userdata["vad"],
            turn_handling={"turn_detection": "realtime_llm", "interruption": {"enabled": True}},
            max_tool_steps=3,
        )
        agent = MacroVoiceAgent(bridge, context)

        @ctx.room.on("data_received")
        def task_event(packet: rtc.DataPacket) -> None:
            if packet.topic != EVENT_TOPIC or packet.participant is None:
                return
            try:
                event = TaskEvent.parse(packet.data, job, packet.participant.identity)
                if bridge.ledger.accept(event):
                    agent.events.put_nowait(event)
            except (ValueError, TypeError, KeyError):
                logger.warning("Ignoring invalid voice task event")
            except asyncio.QueueFull:
                # Fail visibly instead of losing a completion while continuing
                # to speak as though the task's state were known.
                stop("error", "Voice fell behind the agent. Please check its written response.")

        @session.on("error")
        def provider_error(event) -> None:
            if getattr(event.error, "recoverable", False):
                logger.warning("Voice provider is recovering", extra={"voice_session_id": job.voice_session_id, "stage": stage, "error_type": type(event.error).__name__})
            else:
                logger.error("Voice provider failed", extra={"voice_session_id": job.voice_session_id, "stage": stage, "error_type": type(event.error).__name__})
                stop("error", "The voice connection failed. Your agent's work is still available in text.")

        @session.on("session_usage_updated")
        def usage_updated(event) -> None:
            # Usage stays separate from the harness's existing task metering.
            logger.info("Voice usage updated", extra={
                "voice_session_id": job.voice_session_id,
                "usage": [usage.model_dump(mode="json") for usage in event.usage.model_usage],
            })

        @session.on("close")
        def closed(event) -> None:
            if getattr(event, "error", None) is not None:
                stop("error", "The voice connection failed. Your agent's work is still available in text.")
            else:
                stop("ended", "The voice connection ended. Start another whenever you're ready.")

        advance("starting_session")
        await asyncio.wait_for(session.start(
            agent=agent, room=ctx.room,
            room_options=room_io.RoomOptions(
                participant_identity=job.participant_identity,
                audio_input=True, audio_output=True, video_input=False,
                text_input=False, text_output=True,
                # Cleanup owns deletion so terminal attributes and data can
                # reach the caller before SDK close removes the room.
                close_on_disconnect=False, delete_room_on_close=False,
            ),
            record=False,
        ), timeout=30)
        if shutdown.is_set():
            return
        advance("publishing_readiness")
        await asyncio.wait_for(mark_ready(ctx.room.local_participant, job), timeout=5)
        spawn(agent.deliver_results())
        await publish("ready")
        advance("ready")
        session.generate_reply(
            instructions="Briefly say you're listening and ready to continue this Macro conversation. Do not start work or recap old results.",
            tool_choice="none", allow_interruptions=True,
        )

        missing_since: float | None = None
        while not shutdown.is_set():
            now = monotonic()
            if datetime.now(timezone.utc) >= job.expires_at:
                stop("ended", "This voice session reached its time limit. Start another whenever you're ready.")
                break
            # Muting, listening, and waiting for work are valid connected
            # states. Only an actually absent caller starts the grace period;
            # our own reconnect has no authoritative participant roster.
            if ctx.room.connection_state != rtc.ConnectionState.CONN_CONNECTED:
                missing_since = None
            elif job.participant_identity not in ctx.room.remote_participants:
                if missing_since is None:
                    missing_since = now
                if now - missing_since >= CALLER_RECONNECT_GRACE_SECONDS:
                    stop("ended", "Voice ended because the caller did not reconnect. Start another whenever you're ready.")
                    break
            else:
                missing_since = None
            try:
                await asyncio.wait_for(shutdown.wait(), timeout=1)
            except TimeoutError:
                pass
    except Exception as error:
        logger.error("Voice session failed", extra={"voice_session_id": job.voice_session_id, "stage": stage, "error_type": type(error).__name__})
        stop("error", "Voice could not connect. Please try again or continue in text.")
    finally:
        advance("closing")
        if termination:
            await publish(*termination)
        for task in list(background):
            task.cancel()
        await asyncio.gather(*list(background), return_exceptions=True)
        if bridge:
            await bridge.close()
        try:
            if session:
                await session.aclose()
        finally:
            if room_connected:
                try:
                    await asyncio.wait_for(ctx.delete_room(), timeout=5)
                except Exception as error:
                    logger.warning("Voice room cleanup failed", extra={"voice_session_id": job.voice_session_id, "stage": stage, "error_type": type(error).__name__})
            ctx.shutdown(reason="voice session ended")


async def mark_ready(participant: rtc.LocalParticipant, job: VoiceJob) -> None:
    """Persistent readiness survives a lost data packet and late room observers."""
    await participant.set_attributes({"macro.voice.ready": job.voice_session_id})


def worker_options(*, validate: bool) -> WorkerOptions:
    return WorkerOptions(
        entrypoint_fnc=entrypoint,
        request_fnc=request_job,
        prewarm_fnc=prewarm,
        agent_name=AGENT_NAME,
        num_idle_processes=1,
        job_memory_warn_mb=1_024,
        drain_timeout=110,
        **connection_options(os.environ, required=validate),
    )


if __name__ == "__main__":
    try:
        options = worker_options(validate=requires_credentials(sys.argv[1:]))
    except VoiceConfigurationError as error:
        # This exception contains setting names only, never their values.
        raise SystemExit(str(error)) from None
    cli.run_app(options)
