from dotenv import load_dotenv
from livekit.agents import AgentServer, JobContext, Agent, AgentSession, cli, inference

load_dotenv()

server = AgentServer()


@server.rtc_session(agent_name="macro-transcriber")
async def entrypoint(ctx: JobContext):
    session = AgentSession(
        stt=inference.STT(model="deepgram/nova-3-general"),
    )

    await session.start(
        agent=Agent(instructions="Transcribe user speech."),
        room=ctx.room,
    )
    await ctx.connect()


if __name__ == "__main__":
    cli.run_app(server)
