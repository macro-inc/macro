# Macro agent voice worker

This worker is the native voice runtime for an existing Macro agent session.
OpenAI Realtime owns the conversation, semantic turn detection, interruptions,
and tool selection. Its function calls execute directly through Macro's shared
toolset and review flow. The ordinary text model is suspended while voice owns
the session; typed prompts go to the same realtime model. The browser carries
audio and observes canonical history, with no task delegation RPCs.

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

The image runs `worker.py start` as a non-root user. Dispatch and registration
derive the same name from existing stack identity: `macro-agent-voice-dev` or
`macro-agent-voice-prod` when hosted, and
`macro-agent-voice-local-<COMPOSE_PROJECT_NAME>` for local stacks. Normal stack
startup supplies `ENVIRONMENT` and `COMPOSE_PROJECT_NAME` automatically. When
running directly, use the same values as the harness (local defaults to project
`macro`). Do not reuse the channel transcription worker's deployment ID.
Voice is always enabled for Macro agents; there is no enable switch. The harness
service requires `LIVEKIT_SERVER_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`
and validates them at startup. Local Compose and ECS pass the voice worker's
LiveKit/OpenAI settings and stack identity, without Macro backend credentials. ECS uses the
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
printing credentials or conversation content. The worker must register with the
same stack-scoped name as the harness in the LiveKit project used for the room.
Before accepting a dispatch, it probes the job's runtime URL with a short-lived,
room-scoped credential. Only the backend holding that exact active voice lease
returns availability. An unreachable or different stack is rejected within two
seconds so LiveKit can offer the job to another worker. This also separates
developers who share a project name and LiveKit credentials on different machines.
If no worker becomes ready, the browser stops capture and reports a connection
error instead of remaining on Connecting.

## Conversation behavior

- Six voices: Marin, Cedar, Alloy, Coral, Sage and Verse. Select before connecting.
- Realtime semantic VAD owns endpointing and interruptions. LiveKit reconciles
  playback with the Realtime session when speech is interrupted.
- Interrupting speech dismisses pending reviews without cancelling product
  actions already executing. Explicit Stop cancels work through ACP. Completed
  effects cannot be undone.
- Permission requests and structured questions use the existing on-screen controls.
- No raw audio recording. Final user speech, heard assistant text, and tool
  calls/results are recorded in the canonical agent transcript.
- The worker stops at 30 minutes or after a 120-second
  caller disconnect grace. Ending voice restores text-mode eligibility; text
  resumes from the canonical log, including late tool results.

## Protocol and failure handling

Backend dispatch metadata is schema version 1 and identifies the agent session,
voice session, caller, expected worker, voice, absolute expiry, and backend runtime
URL. The worker opens that authenticated WebSocket using a short-lived signed
LiveKit credential for its exact identity and room. The backend checks the active
voice generation. Browser room credentials cannot attach a runtime. There are no
Macro user tokens in media metadata or in the browser voice transport.

The backend supplies persona instructions, canonical context, and native tool
schemas. Standard ACP carries initialization, typed prompts, cancellation,
questions, and conversation updates. Native audio turns are admitted through the
same serialized session actor without sending their transcript to the model a
second time. Tools wait for durable admission and use a deduplicated call ledger.
The backend owns the canonical tool frames and visual approval requests.
`macro.voice.event` and persistent participant attributes report readiness and
terminal reasons to the browser.

LiveKit media reconnects resume the same model and never replay tool calls. A
failed backend runtime connection ends visibly rather than blindly retrying
side effects. Reopening hydrates canonical history. Automatic speech-provider
failover and native/mobile audio-session integration are not included.

Cumulative provider token counts are forwarded to the backend, deduplicated into
deltas, and attributed to the session owner and canonical session through the
normal usage recorder. Pricing remains owned by that service; unknown model
prices remain unset rather than being guessed.

## Verification

From the repository root, using the installed worker environment and without
provider credentials:

```sh
PYTHONPATH=services/agent_voice services/agent_voice/.venv/bin/python -m unittest discover -s services/agent_voice/tests -v
```

The integration suite runs the pinned LiveKit/OpenAI SDK against a simulated
provider WebSocket. It covers native and typed turns, heard-only transcript
truncation, interrupted tool results, dynamic tool aliases, and provider reconnects
without making provider API calls.

The native socket smoke test connects the actual Python runtime to the Rust
router, harness, and session actor, with fake product tools and no provider or
media API calls. From the repository root:

```sh
docker build -t macro-agent-voice-local services/agent_voice
nix develop --command cargo test -p agent_harness_service --bin agent_harness_service voice_runtime::test::socket -- --include-ignored
```

Before rollout, run real-microphone checks for turn timing, interruption,
echo/noise, accents, task corrections, pending reviews, tab/call contention,
reconnect and provider failure. A headless UI test does not measure perceived
conversation quality or establish ChatGPT voice parity. Desktop web is the initial
target; native/mobile audio-session integration is not included.
