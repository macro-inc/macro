# Backend AI quota enforcement

## Contract and ownership

`ai_billing::domain::AiAdmissionService` admits a **new operation**, using a trusted
`MacroUserIdStr` and a server-selected `AiFeature`. `BillingAdmissionService`
delegates to `BillingService::check_allowance`; consumers must not reproduce
allowance arithmetic, settle usage, or call Stripe to decide admission. The
billing domain owns policy. Authentication, model permissions, and entity access
remain separate requirements; passing billing never grants access.

Premium includes 4,000 list-rate cents per period, Max 20,000. A paid, non-enterprise
seat needs positive `UsageSnapshot.remaining_cents`; exactly zero is exhausted.
The snapshot's `blocked_reason` and the gate use the same ledger calculation:

- Each seat consumes its own included allowance. Unused allowance is not pooled.
- Team members share the payer's prepaid credits and overage cap, including mixed
  Premium/Max teams. Usage from another seat can exhaust that shared headroom.
- Unsettled usage already reduces headroom. A positive credit balance alone does
  not imply admission: those credits may all be needed to cover prior usage.
- Payment suspension disables overage, not still-available included allowance or
  credits. With no headroom, suspension takes precedence over cap/exhaustion codes.
- Free and enterprise decisions remain billing-domain exemptions. Free users do
  not gain access to paid models. Entitlement/settings lookup failure still fails
  closed; an unknown account is not assumed free or enterprise.

The reserved `macro|ai-system@macro.com` identity is exempt, as are the features
`AiProjection`, `AiEditing`, and `Dictation`. There is no staff-email or generic
internal-service exemption. Never substitute the system identity for a missing
user. Trusted internal acting-user requests follow the same admission policy.

`PgUsageReader` excludes all three quota-free features. Their `ai_usage` records
remain available for cost telemetry; they consume no allowance, credits, or
overage. Normal document permissions and dictation's independent rate limits
still apply. A billable chat asking for an edit is still a chat: the exemption
covers the editing operation, not the parent conversation.

## Public errors

Synchronous HTTP adapters return JSON with `error` (public recovery guidance)
and `code` (stable machine-readable discriminator):

| HTTP | Code | Meaning |
| --- | --- | --- |
| 402 | `ai_allowance_exhausted` | No included allowance or usable shared headroom |
| 402 | `ai_overage_limit_reached` | Enabled overage cap exhausted |
| 402 | `ai_overage_payment_failed` | Overage suspended after payment failure and no other headroom |
| 503 | `ai_billing_unavailable` | Billing cannot be checked; retry later, not a purchase requirement |

Unavailable billing says `AI billing is unavailable. Please try again.` Raw
storage/payment errors and payer identity are not returned in admission errors.
Internal diagnostics remain in structured logs. Existing endpoint-specific fields
are retained: DCS chat includes `stream_id`, even though rejection registered no
stream. Do not wait for that stream to produce a response.

MCP uses a tool error (`isError`), with the same `{error, code}` in
`structuredContent` and JSON text content; this is not an HTTP 402 from the MCP
transport. Already-accepted asynchronous work cannot change its HTTP response;
use its job history, lifecycle event, ACP failure, or optional-work log instead.
This backend change introduces no frontend purchase dialog or universal UI handler.

## Enforcement inventory

Paths below are relative to `src/` of the named crate/service. One admission
covers the operation's internal model/tool loop, unless a tool starts a separate
billable operation as explicitly noted.

| Surface and enforcement point | Billed identity / feature | Rejection and boundary |
| --- | --- | --- |
| DCS `api/stream/chat_message.rs::send_chat_message_inner` | Authenticated acting user / `Chat` | After model authorization, before chat/message creation, stream registration, or spawned provider work; HTTP 402/503. Applies even without the separate professional permission and to doc-scoped chat. |
| DCS `api/structured_completion.rs` | Authenticated acting user / `DynamicCompletionsApi` | HTTP 402/503 before gathering; one admission covers gathering and final structured output. |
| `ai_tools::ai_operations::complete_subagent` (including MCP `Subagent`) | Authenticated tool request user, not the host context's system default / parent's server-selected feature and entity | Independent admission before completion and recording; typed tool failure. Cancellation remains available. |
| `memory::domain::service::generate_memory` | User whose memory is generated / `Memory` | One admission covers generation and quality judge. Typed `MemoryError`; detached failures log/skip. Existing memory remains readable and is not replaced by a denial. |
| `import::domain::service::admission::direct_or_ai` | Importing user / `Import` | Before gather or Notion AI fallback, including onboarding/reconciliation/retry jobs. No fallback provider is tried on denial. Synchronous errors use 402/503; background failures persist the public code/message and clear running state. |
| `scheduled_action::domain::ai_runner::AdmittedScheduledAgentRunner::create_chat` | `ScheduledAction::owner_user()`, not event sender / `Automation` | Shared cron, manual, and event preparation, before chat creation. Manual 402/503; history contains `{error, code}`, no chat resource. Fenced claims and event finalization still complete. |
| `channel_bots::domain::trigger_detector::MentionOrInferredDetector::infer` | Authorized message sender / `ChannelBot` | Before inferred classifier. Denied/unavailable classification yields no invocation; human message remains. |
| `channel_bots::domain::service::MacroAiHandler::handle` | `BotEvent.requesting_user` / `ChannelBot` | After conversational authorization, before thinking placeholder or responder. Explicit mentions post the public reason/code in the existing reply mechanism; inferred responses skip. Applies to channel and document parents. |
| `agent_trigger::domain::service::AgentTriggerService` implicit classification | Authorized message sender / `Automation` | Before model-backed judge; denial/unavailability logs and yields no inferred event. Explicit mentions/reply targeting remain deterministic; resulting model work has its own gate. |
| `agent_harness::domain::service` open, ingress/forward, and dispatch admission | New session's trusted owner, then persisted session owner (not a collaborating prompt sender) / `AgentSession` | Macro-funded `InMemory` and `SandboxedCoder` opens and turn-occupying actions are checked, including prompt/compact, queue dispatch and resumed work. HTTP 402/503 before acceptance; dispatch checks again after acceptance/forwarding. |
| `agent_inmem::domain::admission::AdmissionCheckingTurnEngine` | Persisted user owner / `AgentSession` | Defense-in-depth before polling the real engine, including direct execution. Non-user ownership is rejected. Typed terminal error becomes an ACP failure with public code; no provider starts. |
| DCS `service/chat_renamer.rs` | Chat's initiating user / `ChatRename` | Separate optional operation; denial/outage leaves title unchanged, not a failure of the already-admitted chat. |
| `agent_session::domain::name_generation::AdmissionCheckingAgentSessionNameGenerator` | Session owner / `ChatRename` | Separate optional operation, including externally funded sessions; skip model naming when denied/unavailable. |
| `agent_harness::domain::repository_choice::RepositoryChoice` through `HaikuRepositoryChooser` | Persisted session owner / `AgentRepositoryChoice` | Gate only model-assisted choice. Authorized explicit repository/branch and no-candidate paths need no completion. Public startup refusal; no hosted agent minted on refusal, not a fallback to another repository. |

### Asynchronous and non-AI boundaries

Classification and a later bot response are separate operations. So are detached
memory regeneration, automatic naming, and independently initiated Subagent calls.
An admitted parent does not pre-authorize those later operations. A rejected
optional helper need not fail an already-running parent.

Harness dispatch denial clears waiting quota-rejected work and emits
`CommandRejected` with action id, public code and message. Dispatch billing outage
retains the queue head for a later explicit attempt without spinning. A forwarded
HTTP acknowledgement is acceptance, not proof of execution: owning-replica
rechecks can reject it later. Forwarded quota denial emits a lifecycle rejection;
forwarded unavailability is a processing failure, not a retroactive HTTP 503.
Retries of the same already-running/queued action are acknowledgements, not new
spending. No automatic replay of rejected actions or scheduled occurrences after
a purchase is promised; submit a new request or wait for a future occurrence.

Reading history, ordinary search/read tools, human messages, document editing,
dictation, deterministic imports, import state/discard/dismissal, and action
configuration/history/disable/delete do not require billable admission. Stop,
queue removal/editing, permission responses, and billing recovery stay available
under their normal authorization. Advancing a queue can cancel current work but
the next model turn must pass dispatch admission.

Cursor, Codex, Claude Cloud and paired external runtimes use their external
subscription for execution and are not gated for that model execution. Their
Macro-billed repository-choice, naming, and MCP Subagent helpers are separate and
remain gated. Macro-funded sandbox starts are gated; this change does not add a
sandbox inference-metering pipeline.

## Concurrency and accounting limits

**Admission is not a reservation.** There is no transaction reserving a prompt's
estimated cost, no per-token budget, and no mid-loop termination guarantee.
Concurrent requests can all observe positive headroom. In-flight operations may
finish after another operation exhausts the account. Usage recording is delayed
and best-effort; a snapshot cannot include usage not yet written. These races can
overshoot an allowance/cap. A later new operation is denied once the recorded
billing position is exhausted. Independent helpers can still be refused during
an admitted parent; the parent's already-running model loop is not forcibly
terminated by this policy.

Admission does not collect payment or reserve credits/charges. The existing
billing service may remember the current period's seat allowance, but settlement
and Stripe collection remain separate. Credit purchase/webhook and period-sync
paths remain usable while exhausted; a purchase must first cover uncovered usage
before it provides new headroom.

## Production wiring audit

The integrated backend constructors were reviewed against both admission calls
and direct `AgentLoop`, `agent::complete`, structured-completion, and provider
client call sites:

- DCS `main.rs` wraps its existing billing service and passes it to tools/imports;
  memory and renaming use that context's gate.
- `ai_tools::build_context` and `memory::context` construct the database-backed
  gate via `ai_billing::composition`. DSS passes the tool-context gate to both
  bot response and inferred classification. Scheduled actions decorate the shared
  runner with that gate before any preparation.
- MCP `context.rs` uses the composition factory; tool identity comes from
  authenticated request parts rather than the default usage context.
- Both standalone `agent_trigger_service` and the harness-hosted trigger call
  `with_admission` with the real factory.
- `agent_harness_service::main` supplies admission to the harness, wraps the real
  `RigTurnEngine` and Haiku namer, and calls Cursor's `with_ai_admission` before
  constructing its owner-bound repository chooser. Other session constructors
  with `NoOpAgentSessionNameGenerator` make no naming model call.
- Remaining `UnconfiguredAiAdmissionService` constructor defaults are the
  channel response/detector, trigger service and Cursor manager. Their production
  roots above override them; tests explicitly choose fake or unconfigured gates.
  The unconfigured service always returns unavailable, even for exempt features:
  it is a wiring safeguard, never an allow-by-default implementation.
- Direct calls outside the original inventory: `call::outbound::ai_call_summarizer`
  (summary, title and tasks) and `task_dedup::outbound::judge` already record under
  the reserved system identity, not a user account. Task-dedup corpus CLI programs
  are evaluation tooling. AI projections and dictation are explicitly exempt;
  document editing is delegated to the quota-free editing worker. Embedding/index
  infrastructure is not user-billed `ai_usage`. Low-level `agent`/`anthropic`
  clients are provider adapters, not additional operation entry points.

No remaining `allowing request` occurrence was found in the Rust crates/services,
and no inventoried billable production path retained fail-open billing behavior.
Do not infer an exemption from a missing usage record: any newly user-attributed
model operation must add an admission boundary as well as metering.

Re-run before deployment:

```bash
rg -n 'check_allowance|AiAdmission|allowing request' crates/ai_billing crates/ai_tools crates/memory crates/import crates/channel_bots crates/agent_trigger crates/agent_session crates/agent_harness crates/agent_inmem services/document_cognition_service services/scheduled_action
rg -n 'UnconfiguredAiAdmissionService|with_ai_admission|with_admission|ai_admission_service' crates services
rg -n 'AgentLoop::new|agent::complete|dynamic_structured_completion|complete_with_history' crates services
```

## Rollout and rollback

1. Ship the shared admission/error contract and complete quota-free usage query
   first (including generated SQLx metadata). No schema migration is required.
   Ensure billing readers and settlement deploy the same exclusion policy.
2. Deploy fully wired consumers, not intermediate commits with unconfigured
   gates: DCS, DSS, MCP, scheduled actions, standalone trigger and harness service
   (including its in-memory engine, hosted trigger and Cursor helper).
3. Verify every replica with disposable accounts: exhausted Premium/Max, team
   credits, cap, payment suspension, unavailable billing, then credit/period
   recovery. Monitor 402 by code separately from 503, and background rejection
   rates. A billing outage must not be treated as a purchase prompt.
4. Deploy frontend error handling independently; this contract does not require
   or implement new UI. Do not use absence of a dialog as proof of admission.

Rolling a consumer back to pre-enforcement code reopens its bypass; rolling back
only wiring to an unconfigured gate makes billable work unavailable. There is no
fail-open emergency switch here. Prefer fixing billing availability or pausing
billable entry points rather than silently allowing them. Rolling back the usage
query re-includes editing/dictation in recalculated usage and can incorrectly
exhaust accounts; keep the exemption correction when rolling back consumers.

Recalculated historical usage may fall when excluded features are removed from
billing totals. Existing cost records, invoices, consumed credits and payment
ledgers are not rewritten. **No automatic refunds or ledger reversals** are
introduced; historical financial adjustments require a separate reviewed process.

## Verification coverage

DCS `api/stream/chat_message/test/quota.rs` joins real `BillingServiceImpl`,
`PgUsageReader`, `PgBillingRepo`, and `PgUsageRepo` to both HTTP handlers in SQLx
migration-backed disposable databases. The production-factory regression creates
a disposable user through the existing user repository, changes subscription roles
through the roles repository, and compares DCS snapshots with the composition
factory's gate and both handlers. The remaining ledger scenarios fix entitlement
discovery; live subscription/Stripe setup is not exercised. The suite compares
snapshots and gates for exhaustion, mixed team seats, overage, credit recovery,
period changes and exemptions. A separately closed request pool plus stream and
recording sentinels checks rejection before downstream work. The structured
completion storage-outage regression distinguishes real lookup failure (503)
from the same exhausted account's 402. Allowed recovery is checked at admission,
without making a live provider request.

Existing domain regressions in `ai_tools`, `memory`, `import`, `channel_bots`,
`agent_trigger`, `scheduled_action`, `agent_harness`, `agent_session` and
`agent_inmem` use provider/runner fakes to check zero invocations on refusal,
authenticated attribution, queued boundaries, and non-AI recovery controls.
The billing PostgreSQL tests separately verify retained cost records, exemption
filtering, period boundaries, and ledger behavior. Run the affected package suites
with `SQLX_OFFLINE` unset, then `just rust-check`, `just check` and `just check full`.
Browser smoke checks are described in the [chat](AGENT_GUIDE/ai-chat.md#ai-usage-limits),
[channel](AGENT_GUIDE/channels.md#ai-quota-rejection) and
[document](AGENT_GUIDE/documents.md#ai-edit) guides; automated billing tests do not
substitute for those deployed checks.
