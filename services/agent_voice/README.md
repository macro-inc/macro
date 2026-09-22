# Macro agent voice worker

This worker provides a private LiveKit audio conversation for an existing Macro
in-memory agent session. OpenAI Realtime handles speech and semantic turn detection;
the existing Macro harness executes tasks with its selected model, persona and tools.
The browser bridges authenticated agent controls and public task results over
identity-checked LiveKit RPC/data messages. The worker never receives a Macro user
token or its own set of product tools.

## Run

Use Python 3.13 and provision secrets through the approved environment/secret manager.
The worker requires `OPENAI_API_KEY`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and
`LIVEKIT_API_SECRET`. `AGENT_VOICE_MODEL` optionally overrides `gpt-realtime-2.1`.
It must connect to the same LiveKit project as `agent_harness_service`.

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
Deploy this as a separate LiveKit worker in the same project as
`agent_harness_service`. Voice is always enabled for Macro agents; there is no
enable switch. The harness service requires `LIVEKIT_SERVER_URL`, `LIVEKIT_API_KEY`
and `LIVEKIT_API_SECRET` and validates them at startup. Use the existing LiveKit
settings in the deployment's Doppler config, and register `AGENT_VOICE_MODEL`
there if overriding the default model. No deployment is performed by this change.

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
