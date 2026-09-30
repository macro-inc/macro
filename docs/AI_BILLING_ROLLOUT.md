# AI usage tracking rollout

## Current scope: observation, not billing activation

T07 installs **observational per-provider-attempt tracking** for the Rust paths
below. It does not activate the new allowance policy, authorization, credit holds,
credit debits, postpaid liability, or collection. The existing $40 subscription,
legacy analytics/settlement behavior, feature exclusions, and existing enforcement
remain unchanged. Observations must never be replayed as financial authorizations
or converted into historical customer debt.

`UsageRecorder::tracking()` explicitly bridges the existing analytics injection to
an object-safe `UsageTracking` capability. `agent::complete`, history/image and
structured completions, and `AgentLoop` sessions bind immutable operation context;
`MeteredHttpClient` records each actual HTTP execution, including SDK retries.
Injection alone is **not** coverage: code bypassing those boundaries remains outside
this accounting view. `rig_engine` explicitly carries task-local context into its
spawned turn; each session still binds its trusted owner/feature independently.

Composition roots use `ai_usage::pg_recorder`, which constructs the owning-domain
observation service and adapter alongside the existing analytics service. DCS wraps
its existing settling recorder with `with_tracking(..., pg_tracking(...))` instead
of replacing its legacy behavior. The observation service accepts **no funding or
rate-authorization capability**. No host selects `FinancialMode::Activated` here;
its strict admission, budget validation, and error propagation remain intact.

### Persistence and failure semantics

Deploy migration `20260928145631_ai_usage_observations.sql` before these services.
`ai_usage_observation` is physically separate from `ai_financial_invocation`, the
analytics `ai_usage` table, and funding/collection work queues:

- Begin is awaited before supported provider attempts. Final evidence is awaited
  before returning the response to SDK/tool-result parsing. Delivery retries retain
  identical invocation IDs, timestamps and evidence; new provider executions get
  new IDs. Conflicting deliveries fail visibly rather than overwrite facts.
- Request budgets, bodies and headers are unchanged in tracking-only mode. Missing
  provider billing profiles, rates, balances and opt-in do not deny execution.
- Reported disjoint token dimensions are **unpriced (`MissingRate`)**, not free or
  exempt. This path intentionally does not consult mutable analytics rates or claim
  that existing financial rate publications qualify all observed request regimes.
  There is no observational pricing resolver to fail or deny requests. Reviewing
  public rates/cache regimes and adding snapshot-based observational valuation is
  follow-up work; no current/live provider rate verification is claimed.
- Missing, interrupted, unsupported or inconsistent counters remain **unresolved**,
  never zero. Anthropic thinking is included in output; OpenAI inclusive cache and
  reasoning counts are normalized without double counting. Unknown dimensions,
  one-hour cache regimes and compatible-provider zero sentinels are not guessed.
- Storage failures are logged with the invocation ID and error. Begin and final
  delivery are retried on finalization (three attempts); failure is not reported as
  successful persistence and does not block later provider calls. There is no
  durable delivery queue during a database outage: those losses require operational
  follow-up. Pending rows identify process interruptions; they are not funding work.
- Once an HTTP execution starts, provider/evidence exchange survives consumer
  cancellation in an owned task, with a bounded 300-second drain starting only
  when the caller future or stream receiver is dropped. Live requests and live
  consumer streams have no metering-imposed deadline. A process exit
  can still strand a pending observation; a failed begin can leave no row. Missing
  terminal stream evidence is retained as interrupted, not inferred from provisional
  counters. Evidence failures do not add a stream error in tracking-only mode.
- No prompts, tool inputs, outputs, credentials or raw provider response bodies are
  stored in the journal. Attribution is retained independently of user deletion;
  reviewed retention/erasure and pending/unresolved operations tooling remain open.

Analytics aggregates and per-attempt observations are **different accounting
views**. Do not sum them together. Existing final-success aggregates still feed
legacy analytics exactly as before; the observational journal never calls analytics
`record` or the settlement trigger. Independent Anthropic tools add observations,
not new legacy aggregate rows or separate tool fees.

## Producer / host matrix

“Journal” below means awaited, idempotent `ai_usage_observation` evidence, subject
to the explicitly reported outage/process-exit limits above. Tests listed are local
regressions, not live-provider or deployment verification.

| Producer / host | Trusted attribution and injection site | Attempt vs aggregate coverage / evidence | Tests and remaining gaps |
| --- | --- | --- | --- |
| DCS chat, dynamic/structured completion, rename | Per-operation `UsageContext` from existing authenticated handlers; `services/document_cognition_service/src/main.rs` wraps its settling recorder | Rig HTTP attempts → journal, including failed parsing/retries; legacy final aggregates unchanged | `agent` metering/structured tests, DCS package tests; billing activation off |
| Subagent in any common-context host | `crates/ai_tools/src/subagent.rs` replaces shared-context user with `RequestContext.user_id`, retains parent feature/entity | `agent::complete` binds a fresh or matching inherited scope → journal; no shared mutable user | `ai_tools` subagent isolation; `agent` scope/independent recorder tests. Shared system identity is not an authenticated payer |
| MCP native Anthropic tools and subagent | `AuthenticatedToolService` builds `RequestContext` from authenticated HTTP extensions; `services/mcp_service/src/context.rs` injects `pg_recorder`; `ToolServiceContext::FromRef` supplies inherited feature/entity and recorder | Independent Anthropic HTTP attempts and subagent attempts → journal, not merely successful tool aggregates; default feature remains Chat | Anthropic authenticated attribution/malformed-result/failure tests; MCP auth tests. MCP client's own model and remote MCP servers are not covered |
| Anthropic WebSearch, WebFetch, BashCodeExecution, TextEditorCodeExecution in all common hosts | Manual per-operation `FromRef<ToolServiceContext>` copies recorder + feature/entity; tool call always uses authenticated `RequestContext.user_id` | One journal attempt per independent native Messages HTTP execution. Counters recorded before SDK/result parsing, including non-2xx evidence; cancellation retains execution/evidence task. No separate tool fees | `anthropic --features toolset` tests. Native client has no application retry loop; any future retries must create fresh attempt IDs. Server-tool-specific non-token fees are intentionally not priced |
| In-memory harness sessions | `services/agent_harness_service/src/main.rs` common context → `RigTurnEngine`; trusted `TurnRequest.owner`, AgentSession feature | Captured scope carried into spawned turn; AgentLoop binds immutable owner scope; Rig attempts → journal, final analytics retained | `agent` spawned scope/cancellation tests; `agent_inmem` package tests. Non-user owners remain rejected by existing behavior |
| Harness session naming | Independent `pg_recorder` supplied to `HaikuAgentSessionNameGenerator` in harness `main.rs`; session owner, ChatRename feature/entity | One-shot model attempts → journal (feature classification unchanged) | Existing name-generator/host tests plus shared completion tests; not covered merely by common-context injection |
| Harness repository selection | Independent `pg_recorder` passed to `CursorContainerManager` in harness `main.rs`; repository chooser's trusted owner, AgentRepositoryChoice feature | Rust selection completion attempts → journal | Shared completion tests and host tests. Does not cover Cursor's external agent runtime |
| Harness trigger classifier + image captions | Independent recorder in `services/agent_harness_service/src/trigger.rs` passed to `FastModelTriggerJudge` and `VisionImageCaptioner`; authenticated message sender, Automation feature | Structured/image HTTP attempts → journal before existing errors are handled | `agent_trigger` caption tests + `agent` image-budget/cancellation/evidence tests. Non-user fallback remains system/internal, never an authenticated payer |
| Standalone trigger classifier + captions | Same explicit injection in `services/agent_trigger_service/src/main.rs` | Same journal attempt boundary, separate from harness and DCS | Standalone service and shared trigger tests. Caption timeout/error-to-None behavior retained; funding-denial propagation deferred |
| DSS channel responder | `services/document_storage_service/src/main.rs` builds common context; responder binds requesting user, ChannelBot feature | AgentLoop HTTP attempts, native tools and subagents → journal; legacy aggregate retained | Shared agent/tool tests, DSS package tests |
| DSS channel classifier | Separate `pg_recorder` supplied to `FastModelTriggerClassifier` in DSS `main.rs`; requesting user, ChannelBot | One-shot classification attempts → journal | Shared completion/structured tests. This is distinct from the responder's common context |
| DSS call summarizer, import duplicate judges | Independent `pg_recorder` injections already present in DSS `main.rs`; existing user/feature supplied by each producer | Calls using shared Rust completion APIs now produce journal attempts | Shared agent tests and DSS tests; this change does not change their attribution policy |
| Scheduled actions | `services/scheduled_action/src/bins/service.rs` common context; executor binds stored authenticated owner, Automation feature | AgentLoop attempts + native tools/subagents → journal | Scheduled-action package and shared scope tests; remote execution outside this process remains separate |
| DCS imports | DCS `main.rs` passes wrapped recorder to import service; import `drive_session` binds user, Import feature | Rust gather/Notion AgentLoop attempts → journal | Shared agent tests / DCS tests. Remote connector internals are not local model attempts |
| Memory and AI projections | Common host recorder (DCS; memory's own context also uses `pg_recorder`), with existing user-specific Memory / AiProjection contexts | Shared completion/AgentLoop attempts → journal, including native tool subcalls where available | Shared agent/tool regressions; no claim of new end-to-end producer deployment tests |
| Managed harness sandboxes (local/Daytona), external Cursor/Codex/Claude agents | Harness passes provider credentials / external account credentials directly to the runtime | **Not covered** by Rust common-context injection; runtime model calls bypass this HTTP adapter. Rust session naming/selection and calls back to authenticated MCP are the only covered portions | Future runtime-owned producer instrumentation must emit trusted per-attempt provider/model/counter/response IDs and immutable authenticated session attribution to an idempotent journal ingress. No credential/proxy redesign or enforcement is introduced here |
| AI editing worker, dictation/audio, arbitrary raw-provider callers, remote MCP internals | Separate producer ownership; multipart requests explicitly warn when scoped but unsupported | **Not covered by this token-attempt adapter.** Existing aggregate/audio behavior is not per-attempt evidence | Separate worker/audio integrations and trusted ingress required. Do not enable new-policy charging for these paths based on this matrix |

## Verification and future activation gates

Focused regressions cover immutable concurrent-user scopes, inherited/independent
recorders, spawned scope propagation, exact request-budget preservation without
funding capability or support profiles, recorder failures, retry delivery identity,
partial failures, cancellations, excluded feature classification, missing usage and
duplicate delivery. Financial-mode regression tests remain in place. Database tests
prove observations do not enter the financial journal or analytics accounting.

Run affected package tests with `SQLX_OFFLINE` unset; regenerate SQLx metadata from
the repository root. Record actual commands/results in the task handoff. No hosted
mutations, provider calls, Stripe provisioning, flag activation, or UI changes are
part of this rollout.

### Observation deployment gate: identity lifecycle

The current journal stores user and entity identity in `request` JSONB, without a
user foreign key or deletion hook (`20260928145631_ai_usage_observations.sql`).
Deleting an account does not remove that attribution. No retention/erasure worker
or administrative erasure operation is supplied by this change. This is a current
privacy lifecycle gap, not something made safe by leaving billing disabled.

Before deploying this observational wiring to real-user traffic, the data owner
must approve retention and erasure handling (including already-deleted users),
identify the operator responsible, and verify an executable process against the
observation table. Until that gate is satisfied, do not deploy the wiring to
real-user environments. Do not infer a retention duration here, reuse financial
retention requirements for observations, or cascade-delete financial history.
Schema/application merge and test-environment verification are not evidence that
this deployment gate has passed.

Before a future **billing/enforcement** release, separately review/implement:

1. Verified rates, request-regime support, authenticated payer/seat resolution,
   renewal policy activation, and the existing financial admission contract.
2. Coverage or explicit activation blocks for external runtimes, workers, audio,
   remote producers, unsupported dimensions and unresolved evidence. This document
   is not proof of total production coverage.
3. Crash/outage recovery and retention operations; trusted runtime/worker evidence
   ingress; financial-mode cancellation and funding-denial propagation.
4. Credit-first allocation, opt-in/caps, collection idempotency and rollout gates.
   Tracking-only observations are never retroactive funding authorization.
5. An authorized, auditable resolution/release transition for unresolved financial
   attempts. `FinancialUsage::pending` and funding scans only discover work;
   reconciliation stops at missing actual usage, and conflicting finalization
   replays cannot overwrite immutable evidence. Before enabling admission, test
   operator authorization, retained original evidence, idempotent resolution and
   recovery of payer ordering/holds. Never treat missing evidence as zero or
   release a hold merely because a request timed out. This gap may remain deferred
   only while financial admission and policy activation remain unwired.
