import array
import asyncio
import logging
import os
import uuid
from collections import Counter, deque
from datetime import datetime, timedelta, timezone

import httpx
import numpy as np
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
from resemblyzer import VoiceEncoder, preprocess_wav

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
        voice_encoder: VoiceEncoder | None = None,
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
        self.voice_encoder = voice_encoder
        # Rolling buffer of recent audio frames keyed off this participant's
        # stream. Used to compute a speaker-embedding on turn completion.
        # `_audio_sample_rate` and `_audio_num_channels` are captured from
        # the first frame so we can stitch the buffer back into a flat PCM
        # array at embed time without re-inspecting every frame.
        self._audio_frames: deque[rtc.AudioFrame] = deque()
        self._audio_buffered_samples: int = 0
        self._audio_sample_rate: int | None = None
        self._audio_num_channels: int | None = None
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

    # Keep at most ~3 seconds of audio in the rolling buffer per participant.
    # Resemblyzer needs at least ~1.5s of speech for a useful embedding; the
    # cap keeps memory bounded for long-running sessions.
    _AUDIO_BUFFER_MAX_SECONDS = 3.0

    def _record_audio_frame(self, frame: rtc.AudioFrame) -> None:
        if self._audio_sample_rate is None:
            self._audio_sample_rate = frame.sample_rate
            self._audio_num_channels = frame.num_channels
        self._audio_frames.append(frame)
        self._audio_buffered_samples += frame.samples_per_channel
        if self._audio_sample_rate:
            max_samples = int(
                self._AUDIO_BUFFER_MAX_SECONDS * self._audio_sample_rate
            )
            while (
                self._audio_buffered_samples > max_samples
                and self._audio_frames
            ):
                dropped = self._audio_frames.popleft()
                self._audio_buffered_samples -= dropped.samples_per_channel

    def _drain_audio_buffer(self) -> tuple[array.array, int, int] | None:
        """Return the buffered audio as (interleaved int16 PCM, rate, channels).

        Returns `None` when no audio has been captured yet. Clears the buffer
        so the next turn starts fresh.
        """
        if not self._audio_frames or self._audio_sample_rate is None:
            return None
        pcm = array.array("h")
        for frame in self._audio_frames:
            pcm.frombytes(bytes(frame.data))
        sample_rate = self._audio_sample_rate
        num_channels = self._audio_num_channels or 1
        self._audio_frames.clear()
        self._audio_buffered_samples = 0
        return pcm, sample_rate, num_channels

    # Resemblyzer needs at least ~1s of speech for a usable embedding;
    # shorter buffers produce noisy / unreliable vectors.
    _MIN_EMBED_SECONDS = 1.0

    async def _compute_voice_embedding(self) -> list[float] | None:
        """Drain the audio buffer and embed it with Resemblyzer.

        Runs the CPU-bound preprocess+embed on a worker thread to keep the
        agent event loop responsive. Returns `None` when there isn't enough
        speech, when no encoder is configured, or when the model raises.
        """
        if self.voice_encoder is None:
            return None
        drained = self._drain_audio_buffer()
        if drained is None:
            return None
        pcm, sample_rate, num_channels = drained
        if len(pcm) == 0:
            return None
        duration_seconds = len(pcm) / float(sample_rate * max(num_channels, 1))
        if duration_seconds < self._MIN_EMBED_SECONDS:
            return None

        encoder = self.voice_encoder
        pcm_bytes = pcm.tobytes()

        def _embed() -> list[float] | None:
            samples = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
            if num_channels > 1:
                samples = samples.reshape(-1, num_channels).mean(axis=1)
            try:
                wav = preprocess_wav(samples, source_sr=sample_rate)
            except Exception:
                logger.exception("preprocess_wav failed")
                return None
            try:
                embedding = encoder.embed_utterance(wav)
            except Exception:
                logger.exception("voice encoder embed_utterance failed")
                return None
            return embedding.astype(np.float32).tolist()

        return await asyncio.to_thread(_embed)

    async def stt_node(self, audio, model_settings):
        async def _tee():
            async for frame in audio:
                self._record_audio_frame(frame)
                yield frame

        async for event in super().stt_node(_tee(), model_settings):
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
        # Always drain the audio buffer at turn boundary even on empty
        # content so leftover frames don't bleed into the next turn's
        # embedding. _compute_voice_embedding returns None when there's
        # nothing usable.
        embedding = await self._compute_voice_embedding() if content else None
        if not content:
            self._drain_audio_buffer()

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
                "embedding": embedding,
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
                voice_encoder=self.ctx.proc.userdata.get("voice_encoder"),
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
    # Load the Resemblyzer encoder once per worker process so per-turn
    # embedding doesn't pay the model-load cost on the hot path.
    proc.userdata["voice_encoder"] = VoiceEncoder()


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, prewarm_fnc=prewarm, agent_name="macro-transcriber"))
