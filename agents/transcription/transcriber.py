import asyncio
import logging
import os
import uuid
from datetime import datetime, timezone

import httpx
from dotenv import load_dotenv
from livekit import rtc
from livekit.agents import (
    Agent,
    AgentSession,
    AutoSubscribe,
    JobContext,
    JobProcess,
    RoomIO,
    StopResponse,
    cli,
    inference,
    llm,
    room_io,
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
            stt=inference.STT("deepgram/nova-3"),
        )
        self.participant_identity = participant_identity
        self.channel_id = channel_id
        self.http_client = http_client

    async def on_user_turn_completed(
        self, chat_ctx: llm.ChatContext, new_message: llm.ChatMessage
    ):
        content = new_message.text_content
        if content:
            now = datetime.now(timezone.utc).isoformat()
            segment = {
                "segmentId": str(uuid.uuid4()),
                "speakerId": self.participant_identity,
                "content": content,
                "startedAt": now,
                "endedAt": now,
                "isFinal": True,
            }
            try:
                resp = await self.http_client.post(
                    f"{MACRO_API_URL}/call/{self.channel_id}/transcript",
                    json=segment,
                    headers={"x-macro-internal-call": INTERNAL_CALL_SECRET},
                )
                resp.raise_for_status()
            except Exception:
                logger.exception("failed to post transcript segment")
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

        # The room name is the channel_id.
        channel_id = self.ctx.room.name

        # Create RoomIO per participant to avoid handler conflicts
        # when multiple sessions share the same room.
        rio = RoomIO(
            agent_session=session,
            room=self.ctx.room,
            participant=participant,
            options=room_io.RoomOptions(
                text_input=False,
                text_output=True,
                audio_output=False,
            ),
        )
        await rio.start()
        is_first = len(self._sessions) == 0
        await session.start(
            agent=Transcriber(
                participant_identity=participant.identity,
                channel_id=channel_id,
                http_client=self.http_client,
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
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, prewarm_fnc=prewarm))
