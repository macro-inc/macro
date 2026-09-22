# Macro agent voice worker

This worker provides a private LiveKit audio conversation for an existing Macro
in-memory agent session. OpenAI Realtime handles speech and semantic turn detection;
the existing Macro harness executes tasks with its selected model, persona and tools.
The browser bridges authenticated agent controls and public task results over
identity-checked LiveKit RPC/data messages. The worker never receives a Macro user
token or its own set of product tools.

## Run

The worker starts with the normal local/dev stack and deploys as a separate ECS
service in the existing agent-harness-service stack. It must connect to the same
LiveKit project as `agent_harness_service`; creating a room without this worker
does not create an AI participant.

Use Python 3.13 and provision secrets through the approved environment/secret manager.
The worker requires `OPENAI_API_KEY`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and
either `LIVEKIT_URL` or the harness's existing `LIVEKIT_SERVER_URL`.
`AGENT_VOICE_MODEL` optionally overrides `gpt-realtime-2.1` when running directly.
Missing credentials and local placeholder credentials fail worker startup clearly.

For direct development outside the app stack:

```sh
python -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python worker.py download-files
.venv/bin/python worker.py dev
```

For a container, build from this directory and inject the environment at runtime:

```sh
docker build -t macro-agent-voice .
```

The image runs `worker.py start` as a non-root user. The dispatch name is
`macro-agent-voice`; do not reuse the channel transcription worker's deployment ID.
Voice is always enabled for Macro agents; there is no enable switch. The harness
service requires `LIVEKIT_SERVER_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`
and validates them at startup. Local Compose and ECS pass only the voice worker's
LiveKit and OpenAI settings, without Macro backend credentials. ECS uses the
same Doppler-synced secret as the harness, selecting just those four keys, and a
separate task role without Macro permissions. Its health check verifies LiveKit
registration at `http://127.0.0.1:8081/`.

Updating only the browser or Rust binary does not start a missing worker. Run the
normal stack startup/rebuild locally, or deploy the agent-harness-service stack in
hosted environments. Worker source changes trigger that stack's deployment.

## Troubleshooting connection startup

A moving microphone waveform means the browser has captured and published audio;
it does not mean the agent has joined. The browser reports connected only after
the expected worker announces readiness for the current voice session. Readiness
is also stored in participant attributes, so a missed data message cannot leave
the panel waiting forever. Browser autoplay permission is independent of worker
readiness and never blocks the connection deadline.

Check the `agent_voice` container locally or `/ecs/agent-voice-<stack>` logs in
CloudWatch. Startup logs identify the failing stage and exception type without
printing credentials or conversation content. The worker must register as
`macro-agent-voice` in the same LiveKit project used to create the voice room.
If no worker becomes ready, the browser stops capture and reports a connection
error instead of remaining on Connecting.

## Conversation behavior

- Six voices: Marin, Cedar, Alloy, Coral, Sage and Verse. Select before connecting.
- Realtime semantic VAD owns endpointing and interruptions. LiveKit reconciles
  playback with the Realtime session when speech is interrupted.
- Interrupting speech keeps accepted work running. Explicit cancellation names a
  task ID and goes through the harness's conditional cancel/replace endpoint.
- A correction can reserve replacement ordering while the old turn stops. Stale
  targets fail without cancelling newer work. Completed effects cannot be undone.
- Permission requests and structured questions use the existing on-screen controls.
- No raw audio recording. Live captions and conversational filler are ephemeral;
  delegated requests and task results remain in the canonical agent transcript.
- The worker stops at 30 minutes, after five idle minutes, or after a 20-second
  caller disconnect grace. Ending media never cancels durable harness work.

## Protocol and failure handling

Backend dispatch metadata is schema version 1 and identifies the agent session,
voice session, caller, expected worker, voice and absolute expiry. The browser
accepts RPC and audio only from that worker; the worker accepts task events only
from that caller. RPCs and events are bounded to 15,000 UTF-8 bytes.

`macro.voice.context` supplies a bounded public transcript. `macro.agent.request`
uses a stable UUID derived from the provider tool-call ID as the Macro action ID.
`macro.agent.cancel` conditionally cancels that action and optionally supplies a
replacement. Reliable `macro.agent.event` messages carry public progress,
completion and review notices with task IDs and increasing sequence numbers.
`macro.voice.event` reports readiness, errors and termination.

Submission and cancellation waiters survive speech interruption. An ambiguous
delivery is never retried automatically or presented as successful. On media or
provider failure, users continue with the written agent session. Reopening voice
loads public history; it does not replay speech or resubmit work. Existing viewer
event batching can add latency to spoken task results. There is no durable voice
dialogue/replay log or automatic speech-provider failover in this version.

Usage events include the voice session ID and per-model token usage in worker
logs, separately from harness task metering. Session time limits bound consumption;
account billing aggregation is a deployment follow-up.

## Verification

From the repository root, using the installed worker environment and without
provider credentials:

```sh
PYTHONPATH=services/agent_voice services/agent_voice/.venv/bin/python -m unittest discover -s services/agent_voice/tests -v
```

Before rollout, run real-microphone checks for turn timing, interruption,
echo/noise, accents, task corrections, pending reviews, tab/call contention,
reconnect and provider failure. A headless UI test does not measure perceived
conversation quality or establish ChatGPT voice parity. Desktop web is the initial
target; native/mobile audio-session integration is not included.
