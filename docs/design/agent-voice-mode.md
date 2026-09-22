# Conversational voice for agent sessions

Design and implementation scope, 2026-09-22. This targets the new agents system, including Macro's
`macro-inmem` harness and external coding harnesses. It does not add voice to the
legacy chat lifecycle.

**Implemented first slice**

The implementation targets Macro's in-memory harness on desktop web. It adds an
authorized, Redis-coordinated private-room lifecycle in `crates/agent_voice`, a
LiveKit/OpenAI Realtime worker in `services/agent_voice`, and a voice panel with
waveform, six voices, mute/end, captions and connection states. A conditional
cancel/replace operation guards the current action inside the harness and session
actor. Spoken interruptions stop playback without automatically stopping work.

The authenticated browser bridges worker requests to the existing agent session
and forwards public folded task results. The worker has no Macro JWT or product
tools. This deliberately reuses existing acceptance, history, permission and
ordering boundaries. Calls and voice share a browser microphone lock. The worker
uses semantic turn detection; it delegates substantive work to the selected Macro
agent while handling conversational clarification and presentation itself.

The larger contracts below remain the design direction, not a claim that every
stage is implemented. In particular: no durable voice-only dialogue/playback log,
worker-direct backend control channel, low-latency actor subscription, external
harness certification, native/mobile support or measured ChatGPT-equivalent
conversation quality. Delivery uncertainty is exposed without automatic retry.
Task results use existing viewer batching. Media/provider usage is logged
separately; account-level voice billing aggregation remains to be wired.

See [worker operations and verification](../../services/agent_voice/README.md).
Voice is always enabled for supported Macro agents. The harness service requires
valid LiveKit settings at startup, and the voice worker needs provider credentials.

**Recommendation: attach a LiveKit voice conversation to an existing agent
session.** A responsive speech model handles the conversation and delegates work
through the selected harness. The harness remains responsible for task execution,
tools, permissions, and task results. Keep the speech provider replaceable.

This recommendation assumes that a separate voice model may clarify requests,
discuss verified context, and present the harness's results. If every substantive
answer must originate in the selected harness, use streaming STT → harness → TTS
under the same session/control architecture instead. Both can support hands-free
turn detection and interruptions; the latter inherits the harness's response time.

**What exists today**

| Area | Evidence | Consequence |
| --- | --- | --- |
| Unified harness controls | `crates/agent_runtime_protocol/src/domain/action.rs:398` | Prompt, stop, model, compact, permissions and elicitations are shared. Live audio, playback and active-turn steering are absent. |
| Runtime routing | `crates/agent_harness/src/domain/model.rs:111`; `crates/coding_agent_worker/src/harness.rs:31` | Managed providers and externally attached ACP runtimes already share agent sessions. |
| Macro's own harness | `crates/agent_inmem/src/domain/engine.rs:24`; `services/agent_harness_service/src/main.rs:433` | `TurnEngine` runs text turns through the shared agent/tool loop. It is distinct from legacy chat session management. |
| Audio support | `crates/agent_inmem/src/domain/session.rs:46`; `crates/agent/src/stream.rs:13` | Native ACP input skips audio; output is text/thinking/tools/usage. There is no native duplex audio engine today. |
| Queue and stop | `crates/agent_harness/src/domain/service/queue.rs:510`; `crates/agent_harness/src/domain/queue.rs:13` | Prompts serialize. Existing channel steering is cancel plus a priority follow-up. Queues and duplicate detection are process-local. |
| Stream latency | `crates/agent_session/src/domain/service.rs:1097` | Streamed notifications can wait 1,500 ms for persistence and viewer delivery. |
| History | `crates/agent_inmem/src/domain/agent.rs:703`; `crates/agent_inmem/src/domain/replay.rs:55` | History retains generated text, with no record of how much speech a person heard. |
| Human interactions | `crates/agent_session/src/domain/control.rs:18` | Service/runtime identities cannot answer permission or elicitation requests on a user's behalf. |
| Existing calls | `crates/call/src/domain/service.rs:583` | Calls own channel rooms, ringing, transcription and optional recording. These semantics do not fit private agent voice. |
| Existing transcription | `services/transcription/transcriber.py:149`; `services/transcription/transcriber.py:554` | LiveKit Agents, Deepgram and Silero are in use, but with no LLM/TTS and audio output disabled. |
| Browser playback | `apps/web/src/features/channel/Call/CallAudioSink.tsx:25` | The call audio sink explicitly excludes agent participants. |
| Agent UI | `apps/web/src/features/agents-view/components/AgentSessionPane.tsx:225`; `apps/web/src/lib/core/agent-session/AgentSession.ts:76` | Reuse the current agent session/fold and both new-agent composer entry points. |

**How conversational voice works**

LiveKit provides media transport and an agent framework; the chosen speech/model
pipeline and our orchestration determine conversation behavior. Audio must stream
continuously while the mic is enabled. The system detects when someone has finished
a thought, starts speech promptly, yields when interrupted, and maintains context
across spoken and typed turns. A recording uploaded after pressing Send cannot
provide that interaction.

There are three useful architectures:

| Architecture | Benefit | Tradeoff for Macro |
| --- | --- | --- |
| Streaming STT → selected harness → streaming TTS | Same harness generates every answer; interchangeable speech providers | Tool runs and slow first text can leave the user waiting; no acoustic context reaches the harness |
| Native speech-to-speech model with tools | Audio understanding and spoken responses in one model session | Replacing the selected harness can change its execution behavior, context and tools |
| Conversational speech model → existing harness | User can clarify/discuss while work runs; supports text-only harnesses | Two model contexts need explicit coordination and reliable task attribution |

The third architecture best fits the proposed experience. OpenAI documents client
delegation to an application's existing agent/backend, independently of its
provider. This supports the architectural direction, not a guarantee that every
Macro harness will satisfy our latency/reliability requirements.
[OpenAI voice architectures](https://developers.openai.com/api/docs/guides/voice-agents),
[client delegation](https://developers.openai.com/api/docs/guides/live-delegation).

Prototype a LiveKit Realtime bridge with explicit backend operations and compare it
with GPT-Live client delegation. The latter is a strong fit for continuous
conversation, but the current LiveKit plugin documents append-only context, no
response truncation, and delegation events without task arguments. We must build
requests from transcript/application state and test interruption recovery. Do not
promise exact recitation or heard-context repair on an adapter that cannot do it.
[LiveKit GPT-Live integration](https://docs.livekit.io/agents/models/realtime/plugins/gpt-live/).

For the Realtime candidate, select one owner of turn detection and interruption
policy: provider-side detection or LiveKit's detector. Do not let independent
detectors each commit a user turn. LiveKit supports both styles, with different
interruption controls; validate the pinned SDK/plugin versions in the spike.
[LiveKit turn handling](https://docs.livekit.io/agents/logic/turns/),
[Realtime integration](https://docs.livekit.io/agents/models/realtime/plugins/openai/).

**Proposed components**

```mermaid
flowchart LR
  UI[Agent UI and microphone] <-->|WebRTC audio| LK[LiveKit voice room]
  LK <--> W[Voice worker and speech provider]
  UI <-->|Authenticated controls and transcript| V[Agent voice domain service]
  W <-->|Scoped commands and events| V
  V <-->|Existing agent control and event ports| S[Canonical agent session]
  S <--> H[Selected harness]
  H --> T[Existing tools and review flow]
```

Create `crates/agent_voice` for domain policy: authorized start/end, session
ownership, accepted utterances, task routing, cancellation, and reconciliation.
Initially wire it in `services/agent_harness_service`; a new Rust deployment is
unnecessary. Inbound HTTP/worker adapters stay thin. Depend on owning agent-session
and harness ports, with concrete adapters constructed at the composition root.

Create a separate `services/agent_voice` LiveKit worker, initially Python to build
on the team's existing deployment experience. It handles media, provider SDKs,
speech scheduling, and normalized voice events. Keep application authorization,
durable acceptance, and execution policy in Rust. It must not acquire an independent
set of product tools or execute actions around the selected harness.

Create `apps/web/src/features/agent-voice` with the repository's layered feature
layout and injected session/media contracts. An app-level owner keeps voice alive
across navigation. Entry points cover `AgentSessionPane`/`ChatSessionInput`, the
default block-agent composer, and the new-agent creation surface. Creating a voice
conversation first creates/selects the normal agent session and its persona.

Use a dedicated room per voice session with an opaque room identity bound to the
user and agent session. Reuse LiveKit account/infrastructure, lazy SDK loading,
device handling and reconnect patterns. Do not invoke channel call creation or
inherit its ringing/recording behavior. Subscribe playback to the authenticated,
expected voice worker participant; the channel audio sink cannot be reused as-is.

**Contracts and state**

Names below are proposed interfaces, not existing APIs:

- `VoiceSessions`: start, get state, renew/rejoin, end. Start is idempotent and
  returns scoped room credentials and negotiated capabilities after authorization.
- `AgentConversationPort`: snapshot at a cursor, subscribe after a cursor, submit
  an accepted utterance/task, cancel or replace an expected task atomically, and
  observe completion or a pending human interaction. Typed and voice submissions
  share ordering rules.
- `SpeechSession`: receive audio/transcript events, supply conversation context,
  speak or request speech, interrupt playback, and report provider capabilities.
  Native duplex sessions and a streamed STT/TTS pipeline implement distinct adapters.

Represent voice connection state, listening/speaking state, and agent work state
separately. Listening and speaking can overlap. An agent can be working while the
voice layer listens, and a lost media connection does not imply lost agent work.

Identify every voice session, user utterance, task/action, speech generation and
connection epoch. Carry the owning session's fence/lease when delivering controls
and consuming events. Reject callbacks from an old worker after reconnect/takeover.

Persist accepted utterances and their action IDs before execution. Add durable
deduplication and an outbox/reconciliation path through dispatch; existing in-memory
queue IDs alone cannot prevent duplicate execution after a crash. Represent
accepted-but-undispatched work durably. Do not claim exactly-once tool execution:
after ambiguous delivery, reconcile with the agent log/runtime before retrying and
surface uncertainty when the adapter cannot establish what happened.

**Conversation and execution rules**

- The voice model can acknowledge, clarify, discuss supplied context and summarize
  verified results. It delegates workspace reads/actions and substantial selected-
  harness work through the bridge. Only the harness executes product tools.
- Backend work is asynchronous: return a task handle/status promptly and deliver
  progress/results later. A long tool call must not lock the conversation loop.
- Tag task intent revisions and mark superseded work. Late results remain task
  evidence but must not be spoken as satisfying the user's revised request.
- An utterance is not automatically a new agent task. Continuations, acknowledgments,
  corrections and explicit new requests need different handling. Commit stable
  utterances, preserve their original text, and link derived task instructions back
  to them. Do not execute side effects on provisional transcript hypotheses.
- Construct each backend request from relevant committed conversation since its
  last handoff, selected attachments/entity references, and explicit task intent.
  Otherwise details clarified with the voice layer would never reach the harness.
- The canonical agent session owns task evidence. Persist additional voice dialogue
  as session-associated events with source attribution; project it into the same
  user-facing timeline without pretending it was ACP output from the harness.
  Do not execute every voice transcript entry again as a prompt during replay.
- The voice context includes prior spoken/typed turns, a bounded session summary,
  active tasks, open interactions and verified results. Reconstruct it on reconnect.
  Typed messages and other collaborators' changes must enter this context too.
- Speak short public answers and meaningful progress. Keep code, long lists and
  detailed tool output on screen. Do not synthesize speech from thinking blocks or
  raw tool payloads. Never announce a completed action from a provisional status.

**Interrupting speech and interrupting work are different operations.** When the
user starts speaking, stop local playback promptly and invalidate old speech
generation output. This does not automatically send `AgentAction::Stop`: that
operation also clears pending questions/reviews and may interrupt useful work.

For “stop that task” or a correction requiring execution changes, request harness
cancellation, show that stopping is pending, and wait for observed turn completion
before dispatching a replacement. Add a conditional cancel/replace operation to
the same command worker that serializes all session work. It takes the expected
action/turn ID, cancels only that task, and reserves replacement ordering against
queue draining and typed/collaborator submissions. If the target changed, return
already-completed or conflict; never send a delayed session-wide stop against a
new task. A worker lease does not solve this logical race. If supported in the
future, use active-turn steering instead. On timeout, report unresolved work and
avoid starting conflicting actions. Completed tool effects remain completed;
cancellation cannot undo them.

Track generated speech separately from rendered playback, including interruption
and a played-audio offset or aligned text prefix where available. Playback is an
estimate of delivery, not proof the person heard it. Preserve the full written
result while conditioning future voice context on what played. For external
harnesses, pass explicit interruption context at the next handoff instead of
assuming their histories can be truncated. If a speech provider cannot reconcile
context, append a correction or rebuild the connection and test the resulting UX;
that limitation remains visible in its capability contract.

**Latency and persistence**

Add a low-latency, authenticated normalized event subscription near the owning
session actor/fold. Do not source spoken streaming from the current 1.5-second
viewer batches. Reuse fold semantics; do not create per-harness transcript parsers.

Fast events need sequence IDs, turn/generation IDs, an ownership epoch, bounded
buffering and replay reconciliation. They may precede the current durable flush.
Label provisional events accordingly; durable acceptance/results remain the basis
for execution and completion claims. Reconnect must deduplicate and must never
replay old speech automatically. A smaller voice-specific durable flush window is
a simpler alternative if measurements show that it meets latency and database-load
targets; choose during the spike rather than committing to two streams blindly.

Keep PCM/audio packets and partial captions off the ACP/Postgres log. Persist final
dialogue, task links and playback/interruption facts. End the room/worker after
disconnect grace and idle limits; agent work can continue with a visible status.

**Access, reviews and devices**

Starting voice requires current permission to control the selected agent session.
Worker credentials are short-lived and scoped to that user/session/voice lease;
never forward a full user JWT. Authorize subscriptions as well as commands, and
expire/revoke media access on end, access loss or session deletion. Media tokens
alone are not authority to execute an agent command.

V1 reads questions/reviews aloud and uses the existing authenticated visual
interaction controls for submission. A generic worker's “yes” must not bypass the
existing human-principal requirement for permissions or elicitations. Later spoken
answers require explicit user delegation, a single live request ID/turn, validated
answer content and the existing product approval policy. Ordinary conversational
clarifications remain possible without granting worker approval authority.

Voice is private media for one controlling user in v1, even when its underlying
agent session has collaborators. Committed dialogue inherits the agent session's
visibility; make that clear on entry. One active voice controller per session and
one microphone owner per client prevent competing speakers. Joining a human call
requires an explicit audio handoff. Do not silently broadcast AI conversation into
a call or capture a human call for the agent.

Start with desktop web. Native iOS calls currently use Swift LiveKit plus CallKit-
owned AVAudioSession activation, so native AI voice needs a deliberate adapter and
device verification. Do not label it supported based on desktop browser tests.
Default to no raw audio recording; set transcript retention/deletion consistently
with agent sessions. Meter voice/provider/media costs separately from harness work,
with duration/idle limits and bounded reconnect attempts.

**Compatibility policy**

| Capability | Policy |
| --- | --- |
| Prompt + readable results | Can support delegated conversation, subject to latency and reliability certification |
| Streaming public text/progress | Enables earlier informative speech |
| Cancel + observable turn completion | Enables safe cancel-and-replace; never infer this from a successful HTTP response |
| Durable resume/history | Enables reconnect without restarting tasks blindly |
| Structured questions/reviews | Reuse existing interaction protocol and user authority |
| Active-turn input | Optional richer steering; absent from the common contract today |
| Native audio / editable speech context | Optional richer speech adapter; absent from Macro's native harness today |

Record capabilities per adapter/version/session, independently for speech provider
and execution harness. Ship only tested combinations; a polling-only or opaque
harness can expose reduced task-oriented voice behavior without claiming the same
latency or control as a streaming runtime. Voice support is not inherently limited
to Macro's harness, and identical behavior across every harness is not promised.

**Implementation sequence and acceptance**

1. Build a narrow evaluation spike: one existing Macro agent session, one private
   LiveKit room, one voice worker, and the task bridge. Compare streaming STT/TTS,
   a Realtime bridge, and GPT-Live client delegation on the same recorded requests.
   Test an external ACP coding harness early to validate the abstraction. Measure
   actual SDK/plugin behavior, context fidelity and provider access before selection.
2. Implement the domain/control foundation: scoped authorization, controller lease,
   durable utterance acceptance/deduplication, context handoff, task ordering,
   conditional cancel/replace, cancellation observation, event delivery, voice
   transcript projection, and usage. Include idle/max-duration limits, bounded
   reconnect and stale-worker fencing. Run domain and adapter tests with fake ports
   before UI rollout.
3. Ship a desktop-web vertical slice for Macro's own harness behind a feature flag:
   start/end/mute, partial captions, listening/working/speaking indicators, immediate
   playback interruption, visual reviews, typed fallback and recoverable errors.
   Enforce one microphone owner across tabs/sessions, reject stale audio, and block
   human-call conflicts or require an explicit handoff before enabling capture.
   Ensure the selected persona/model/tools and existing task history are preserved.
4. Certify Claude Code/Codex adapters individually with the same conformance suite;
   document cancel/resume/interaction limitations. No brand-specific voice pipeline
   should be required to add a compatible harness.
5. Expand failover/recovery coverage, device switching, and calls/voice handoff UX.
   Add native/mobile only after its audio-session adapter
   and real-device checks. Update the app agent guide with the new voice flow.

The required test matrix covers silence and natural pauses; short acknowledgments;
accents/names/noise; delayed final transcripts; correction during a tool call;
interruptions before/after an action commits; pending reviews; duplicated delivery;
worker/server restart; revoked access; stale audio; reconnect without replay;
typed/voice concurrency; mic denial; autoplay; navigation; tabs; and call contention.

Measure speech endpointing, first audible response, first useful answer, playback
stop, backend cancellation/completion, task success, and cost independently. Proposed
initial budgets are p95 local playback stop within 250 ms of a confirmed interruption
and p95 first useful conversational response within 1.5 seconds after turn end on
the controlled desktop test setup. These are targets to validate, not current
capabilities; task completion may take much longer. Acknowledgment filler does not
count as a useful answer.

Use deterministic audio/event fixtures plus real browser tests for media/control
behavior, then human listening tests with actual microphones for conversation
quality. Headless Chromium alone cannot establish naturalness or mobile behavior.
Run affected tests and `just check` for implementation changes.

**Verification limits**

Implementation verification uses the isolated `herdr-22000` local stack, targeted
Rust tests (including live PostgreSQL/Redis), frontend lifecycle and transport
tests, pinned-SDK worker tests without network access, the worker container build,
and Chromium UI checks. The existing stack's data is retained. Live provider audio,
actual microphone turn-taking and perceived conversation quality still require
provisioned provider credentials and listening tests. External harness behavior
has not been certified.
