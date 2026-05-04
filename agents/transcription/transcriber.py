import asyncio
import logging
import os
import uuid
from collections import Counter
from datetime import datetime, timedelta, timezone

import httpx
from dotenv import load_dotenv
from livekit import rtc
from livekit.agents import (
    Agent,
    AgentSession,
    AutoSubscribe,
    JobContext,
    JobProcess,
    StopResponse,
    cli,
    inference,
    llm,
    room_io,
    stt as stt_pkg,
    utils,
    WorkerOptions,
)
from livekit.plugins import silero

load_dotenv()

logger = logging.getLogger("macro-transcriber")

MACRO_API_URL = os.environ.get("MACRO_API_URL", "http://localhost:8080")
INTERNAL_CALL_SECRET = os.environ.get("INTERNAL_CALL_SECRET", "")


class Transcriber(Agent):
    """STT-only agent bound to a single participant."""

    def __init__(
        self,
        *,
        participant_identity: str,
        channel_id: str,
        http_client: httpx.AsyncClient,
    ):
        super().__init__(
            instructions="Transcribe user speech.",
            stt=inference.STT(
                "deepgram/nova-3",
                language="en-US",
                extra_kwargs={
                    # ms of silence before Deepgram finalizes an utterance.
                    # Library default is 25ms, which cuts hesitant speakers mid-thought.
                    "endpointing": 400,
                    "smart_format": False,
                    "punctuate": True,
                    "filler_words": True,
                    "numerals": True,
                    "interim_results": True,
                    "no_delay": True,
                    # Emit per-word speaker labels so we can attribute segments to
                    # distinct voices even when one audio track carries multiple.
                    "diarize": True,
                },
            ),
        )
        self.participant_identity = participant_identity
        self.channel_id = channel_id
        self.http_client = http_client
        # Word counts per Deepgram speaker int, accumulated across final
        # transcripts inside a single user turn and cleared on turn completion.
        self._pending_speakers: Counter[int] = Counter()
        # Wall-clock estimate of the STT stream's t=0 (the moment Deepgram
        # began consuming this participant's audio). Each FINAL gives us
        # an upper bound — `now() - words[-1].end_time` is at most
        # `true_t0 + final_delivery_lag` — so the MIN across FINALs
        # converges to the true value. Used to translate Deepgram's
        # stream-relative word offsets into absolute UTC for segment
        # timestamps and to anchor the recording timeline on the server.
        self._stream_t0_wall: datetime | None = None
        # Min/max Deepgram-stream-relative word offsets (seconds) seen
        # across FINALs within the current turn. Combined with
        # `_stream_t0_wall` these give started_at/ended_at without baking
        # in FINAL-delivery lag.
        self._pending_first_word_offset: float | None = None
        self._pending_last_word_offset: float | None = None
        # Deepgram's speaker ints are only unique within one streaming session.
        # Namespace them with a nonce regenerated per Transcriber so a reconnect
        # doesn't silently merge two different humans under the same UUID.
        self._speaker_namespace = uuid.uuid4().hex
        self._speaker_uuids: dict[int, str] = {}

    def _resolve_diarized_speaker_id(self, dg_speaker: int) -> str:
        cached = self._speaker_uuids.get(dg_speaker)
        if cached is not None:
            return cached
        seed = (
            f"{self.channel_id}:{self.participant_identity}:"
            f"{self._speaker_namespace}:{dg_speaker}"
        )
        value = str(uuid.uuid5(uuid.NAMESPACE_URL, seed))
        self._speaker_uuids[dg_speaker] = value
        return value

    async def stt_node(self, audio, model_settings):
        async for event in super().stt_node(audio, model_settings):
            if isinstance(event, stt_pkg.SpeechEvent) and (
                event.type == stt_pkg.SpeechEventType.FINAL_TRANSCRIPT
            ):
                alt = event.alternatives[0] if event.alternatives else None
                words = list(getattr(alt, "words", None) or ())
                if words:
                    first_offset = words[0].start_time
                    last_offset = words[-1].end_time

                    # Refine stream-t0 estimate. `now() - last_word.end_time`
                    # bounds true_t0 from above (because now() arrives at
                    # least final_delivery_lag after the last word ended);
                    # the MIN across FINALs is our best estimate.
                    implied_t0 = datetime.now(timezone.utc) - timedelta(
                        seconds=last_offset
                    )
                    if (
                        self._stream_t0_wall is None
                        or implied_t0 < self._stream_t0_wall
                    ):
                        self._stream_t0_wall = implied_t0

                    if (
                        self._pending_first_word_offset is None
                        or first_offset < self._pending_first_word_offset
                    ):
                        self._pending_first_word_offset = first_offset
                    if (
                        self._pending_last_word_offset is None
                        or last_offset > self._pending_last_word_offset
                    ):
                        self._pending_last_word_offset = last_offset

                    for word in words:
                        speaker = getattr(word, "speaker", None)
                        if speaker is None:
                            speaker = getattr(word, "speaker_id", None)
                        if speaker is not None:
                            self._pending_speakers[int(speaker)] += 1
            yield event

    async def on_user_turn_completed(
        self, chat_ctx: llm.ChatContext, new_message: llm.ChatMessage
    ):
        content = new_message.text_content
        # Snapshot pending state and clear unconditionally so an empty-content
        # turn (e.g. VAD ended a turn with no final text) can't leak word
        # offsets or speaker counts into the next turn's accumulators.
        first_word_offset = self._pending_first_word_offset
        last_word_offset = self._pending_last_word_offset
        pending_speakers = self._pending_speakers
        self._pending_first_word_offset = None
        self._pending_last_word_offset = None
        self._pending_speakers = Counter()

        if content:
            now = datetime.now(timezone.utc)
            if (
                self._stream_t0_wall is not None
                and first_word_offset is not None
                and last_word_offset is not None
            ):
                started_at = self._stream_t0_wall + timedelta(
                    seconds=first_word_offset
                )
                ended_at = self._stream_t0_wall + timedelta(
                    seconds=last_word_offset
                )
            else:
                started_at = now
                ended_at = now

            extra = new_message.extra if isinstance(new_message.extra, dict) else {}
            source_id = (
                extra.get("provider_message_id")
                or extra.get("providerMessageId")
                or new_message.id
            )
            segment_seed = (
                f"{self.channel_id}:{self.participant_identity}:{source_id}:"
                f"{started_at.isoformat()}"
            )
            segment_id = str(uuid.uuid5(uuid.NAMESPACE_URL, segment_seed))

            diarized_speaker_id = None
            if pending_speakers:
                dominant_speaker, _ = pending_speakers.most_common(1)[0]
                diarized_speaker_id = self._resolve_diarized_speaker_id(dominant_speaker)

            segment = {
                "segmentId": segment_id,
                "speakerId": self.participant_identity,
                "diarizedSpeakerId": diarized_speaker_id,
                "content": content,
                "startedAt": started_at.isoformat(),
                "endedAt": ended_at.isoformat(),
                # Sent so the server can anchor `recording_started_at` to
                # the earliest first-audio-frame instant across participants
                # rather than the egress webhook envelope time (which fires
                # before any audio is captured).
                "streamStartedAt": (
                    self._stream_t0_wall.isoformat()
                    if self._stream_t0_wall is not None
                    else None
                ),
                "isFinal": True,
            }
            max_attempts = 3
            delay_seconds = 0.25
            for attempt in range(1, max_attempts + 1):
                try:
                    resp = await self.http_client.post(
                        f"{MACRO_API_URL}/call/{self.channel_id}/transcript",
                        json=segment,
                        headers={"x-macro-internal-call": INTERNAL_CALL_SECRET},
                    )
                    resp.raise_for_status()
                    break
                except (httpx.TimeoutException, httpx.NetworkError) as exc:
                    if attempt == max_attempts:
                        logger.exception(
                            "failed to post transcript segment segmentId=%s error=%s",
                            segment_id,
                            exc,
                        )
                        break
                    await asyncio.sleep(delay_seconds)
                    delay_seconds *= 2
                except httpx.HTTPStatusError as exc:
                    status_code = exc.response.status_code if exc.response else None
                    is_transient = (
                        status_code is not None and 500 <= status_code < 600
                    )
                    if is_transient and attempt < max_attempts:
                        await asyncio.sleep(delay_seconds)
                        delay_seconds *= 2
                        continue
                    logger.exception(
                        "failed to post transcript segment segmentId=%s error=%s",
                        segment_id,
                        exc,
                    )
                    break
                except Exception as exc:
                    logger.exception(
                        "failed to post transcript segment segmentId=%s error=%s",
                        segment_id,
                        exc,
                    )
                    break
        raise StopResponse()


class MultiUserTranscriber:
    """Manages one AgentSession per participant so all speakers are transcribed."""

    def __init__(self, ctx: JobContext, http_client: httpx.AsyncClient):
        self.ctx = ctx
        self.http_client = http_client
        self._sessions: dict[str, AgentSession] = {}
        self._tasks: set[asyncio.Task] = set()

    def start(self):
        self.ctx.room.on("participant_connected", self.on_participant_connected)
        self.ctx.room.on(
            "participant_disconnected", self.on_participant_disconnected
        )

    async def aclose(self):
        await utils.aio.cancel_and_wait(*self._tasks)
        await asyncio.gather(
            *[self._close_session(s) for s in self._sessions.values()]
        )
        self.ctx.room.off("participant_connected", self.on_participant_connected)
        self.ctx.room.off(
            "participant_disconnected", self.on_participant_disconnected
        )

    def on_participant_connected(self, participant: rtc.RemoteParticipant):
        if participant.identity in self._sessions:
            return

        logger.info(f"starting transcription session for {participant.identity}")
        task = asyncio.create_task(self._start_session(participant))
        self._tasks.add(task)

        def on_done(t: asyncio.Task):
            try:
                self._sessions[participant.identity] = t.result()
            finally:
                self._tasks.discard(t)

        task.add_done_callback(on_done)

    def on_participant_disconnected(self, participant: rtc.RemoteParticipant):
        session = self._sessions.pop(participant.identity, None)
        if session is None:
            return

        logger.info(f"closing transcription session for {participant.identity}")
        task = asyncio.create_task(self._close_session(session))
        self._tasks.add(task)
        task.add_done_callback(lambda t: self._tasks.discard(t))

    async def _start_session(
        self, participant: rtc.RemoteParticipant
    ) -> AgentSession:
        session = AgentSession(vad=self.ctx.proc.userdata["vad"])
        is_first = len(self._sessions) == 0
        await session.start(
            agent=Transcriber(
                participant_identity=participant.identity,
                channel_id=self.ctx.room.name,
                http_client=self.http_client,
            ),
            room=self.ctx.room,
            room_options=room_io.RoomOptions(
                audio_input=True,
                text_input=False,
                text_output=True,
                audio_output=False,
                participant_identity=participant.identity,
            ),
            record=is_first,
        )
        return session

    async def _close_session(self, session: AgentSession):
        await session.drain()
        await session.aclose()


async def entrypoint(ctx: JobContext):
    http_client = httpx.AsyncClient()
    transcriber = MultiUserTranscriber(ctx, http_client)
    transcriber.start()
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    for participant in ctx.room.remote_participants.values():
        transcriber.on_participant_connected(participant)

    async def shutdown():
        await transcriber.aclose()
        await http_client.aclose()

    ctx.add_shutdown_callback(shutdown)


def prewarm(proc: JobProcess):
    proc.userdata["vad"] = silero.VAD.load()


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, prewarm_fnc=prewarm, agent_name="macro-transcriber"))
