# AI usage quota enforcement

## Scope and policy

`ENABLE_AI_USAGE_ENFORCEMENT` enables **legacy, snapshot-based admission and
prospective counting of existing `ai_usage` producers**. It is not a provider-spend
cap, a reservation system, or activation of financial admission. It does not select
`FinancialMode::Activated`, authorize credit holds, or convert observations into
customer debt. Usage-driven credit consumption and Stripe settlement are gated by
the separate default-off [`ENABLE_AI_USAGE_BILLING`](#settlement-enable_ai_usage_billing)
policy, never by this flag or the deployment environment. See
[the separate observation/financial rollout](AI_BILLING_ROLLOUT.md).

The [startup loader](../crates/ai_usage/src/config.rs) accepts only raw `true` or
`false`; absent means false. Empty, quoted, `null`, or otherwise malformed present
values fail startup. Hosts load the policy once, not per request. Changing it
requires restarting/redeploying every participating process.

The [shared policy](../crates/ai_usage/src/domain/counting.rs) is identical for
admission and recording:

| Policy / work | Admission | New `ai_usage.count_usage` |
| --- | --- | --- |
| Absent or false | Return before billing I/O | `false` |
| True, real user, billable feature | Check existing allowance; fail closed on validation error | `true` when existing producer records usage |
| True, exempt feature | No quota billing I/O | `false` |
| Genuinely system-owned work | No user quota billing I/O | `false` |
| Rejected before execution | No provider work | No usage row for work not executed |
| Historical rows / inserts omitting column | Never retrospectively classified | `false` |
| Disabled after activation | Stop admission and new counting | Existing booleans unchanged |

**Exempt:** Memory, AiProjection, CallSummary, Dictation, ChatRename.
**Billable:** Chat, Automation, DynamicCompletionsApi, ChannelBot, AiEditing,
Import, AgentSession, AgentRepositoryChoice, ImageGeneration. In particular, AI
editing is not exempt.
The classification is exhaustive and server-selected, not request-controlled.

Unlimited (enterprise) entitlements are never blocked by this quota policy.
Free-plan users are hard-capped at `AI_USAGE_FREE_INCLUDED_ALLOWANCE_CENTS` of
counted usage per UTC calendar month: past it, admission answers
`ai_free_allowance_exhausted` and nothing is settled, since Free has no credits
or overage. Model-access and resource permissions remain independent. Counting
eligibility is not a claim that a particular user owes money; it does not
special-case their plan. Existing paid allowance, per-seat usage, payer credits,
automatic reload opt-in, and denial decisions remain in the legacy ledger.

### Persistence

The [usage service](../crates/ai_usage/src/domain/service.rs) computes the boolean
for both `record()` and `record_now()`, before the
[repository insert](../crates/ai_usage/src/outbound/pg_usage_repo.rs). Clients cannot
supply it. The [billing reader](../crates/ai_billing/src/outbound/pg_usage_reader.rs)
uses the persisted literal `count_usage = TRUE`, not a mutable feature exclusion
list. User/team-seat scoping, `[start, end)` periods, at-cost arithmetic, and
fallback pricing for null totals are retained. Admin analytics still includes
uncounted rows; repricing can change totals, never eligibility.

[Counting tests](../crates/ai_usage/src/domain/counting/test.rs),
[recording tests](../crates/ai_usage/src/domain/service/test.rs),
[persistence/repricing tests](../crates/ai_usage/src/outbound/pg_usage_repo/test.rs),
and [billing-reader tests](../crates/ai_billing/src/outbound/pg_usage_reader/test.rs)
cover these distinctions. Historical analytics and observations must never be
backfilled into counted usage or financial authorizations.

## Settlement: `ENABLE_AI_USAGE_BILLING`

`ENABLE_AI_USAGE_BILLING` enables **legacy settlement of counted usage past a
payer's allowance**: prepaid credits are consumed and optional automatic reloads
purchase more credits through Stripe. Direct usage charges are disabled. The
[startup loader](../crates/ai_billing/src/config.rs)
parses it exactly like the enforcement flag (absent means false; only raw `true`
or `false`; malformed present values fail startup) and hosts load it once. It is
independent of `ENABLE_AI_USAGE_ENFORCEMENT` and of the deployment environment:
there is no longer an `Environment::Develop` safeguard, so a true value settles
in production.

Pricing is four mandatory Doppler values, loaded once at startup by every host that
composes `ai_billing` (see [`config.rs`](../crates/ai_billing/src/config.rs) and
[`pricing.rs`](../crates/ai_billing/src/domain/pricing.rs)): one allowance per plan,
measured at provider cost — `AI_USAGE_FREE_INCLUDED_ALLOWANCE_CENTS` (the free plan's
hard cap, per user per UTC calendar month), `AI_USAGE_INCLUDED_ALLOWANCE_CENTS`
(Premium, per seat per subscription period), and `AI_USAGE_MAX_INCLUDED_ALLOWANCE_CENTS`
(Max, per seat per subscription period) — and `AI_USAGE_OVERAGE_MARKUP_PERCENT`,
the whole-percent markup over cost applied to paid usage beyond the allowance before
credits are consumed. There is no default in code: a missing,
malformed, or out-of-range value fails startup and the Doppler CI validator. The values live in `shared_ai` (`lcl`,
`dev`, `prd`), which every participating service inherits except the authentication
service, whose `dev` and `prd` configs carry them directly; the no-Doppler local
stack stubs them in `BootStubEnv`. The markup is applied to the period's cumulative
chargeable cost, so settling in chunks books the same money as settling once.
Change the values in Doppler and redeploy to change pricing. The plan catalog
(`GET /ai-billing/plans`) publishes `included_ai_cents_per_seat` for every tier,
and the frontend reads allowances from it
(`useIncludedAiCentsByTier`) rather than hard-coding them. Frozen per-period
rosters keep their cost amounts in `ai_billing_period_allowance.included_cost_cents_by_user`;
rows written before that column existed are priced at the configured allowance.

The hosts that participate:

| Host | Gate | When disabled |
| --- | --- | --- |
| Authentication service | [`BillingServiceImpl::settle`](../crates/ai_billing/src/domain/service.rs) guards every caller: summary reads, automatic reload changes, credit-purchase webhooks, the internal settle endpoint, and the [reconciliation sweep](#reconciliation-sweep-and-closed-periods). It also reserves and collects automatic credit reloads | Returns without reading entitlements, consuming credits, reloading credits, or touching Stripe; the sweep is not started. Credit purchases are still booked and remain unconsumed |
| Document cognition, agent harness, MCP, and scheduled action services | [`SettlingUsageRecorder`](../crates/ai_billing/src/outbound/settling_recorder.rs) requests settlement after counted usage lands. Document cognition composes it inline around its admission instance; the other three compose it through [`pg_settling_recorder`](../crates/ai_billing/src/composition.rs) with the [`SettlementRoute`](../crates/ai_billing/src/composition.rs) their configuration resolves | Usage is still recorded and counted; no settlement request is sent |

Every host composes admission through
[`pg_admission_service`](../crates/ai_billing/src/composition.rs) (or document
cognition's inline equivalent), which never settles regardless of
configuration. The authentication service's policy is authoritative: a request
from another host is a no-op there while its flag is false, and with every
other host false the authentication service still settles on summary reads,
automatic reload changes, credit purchases, and the sweep. Enable them
together. Settlement without `ENABLE_AI_USAGE_ENFORCEMENT` finds nothing to
settle, because only counted rows are chargeable.

A requesting host other than document cognition presents the authentication
service's own internal key, `AUTHENTICATION_SERVICE_SECRET_KEY` (document
cognition already holds it). The key is optional in those hosts' configuration
while `ENABLE_AI_USAGE_BILLING` is false and mandatory once it is true: a host
enabling billing without the key fails startup rather than quietly recording
chargeable usage that only the sweep settles. Hosts without the recorder
(document storage, the standalone trigger service, memory) are covered by the
sweep alone; memory's usage is exempt and never chargeable.

### Reconciliation sweep and closed periods

A settlement request is a request: it can be lost (bounded HTTP retries, a
reload whose collector died between reserving and invoicing) or never come (a
period that closed after the payer's last completion). Two mechanisms in the
authentication service recover such usage without a customer action:

- **The sweep.** [`SettlementSweep`](../crates/ai_billing/src/domain/sweep.rs)
  runs on a schedule
  ([`run_settlement_sweep`](../crates/ai_billing/src/inbound/sweep_worker.rs):
  a minute after boot, then hourly) and settles, once each, every metered
  payer with a candidate in the last 24 hours
  ([`PgSettlementCandidates`](../crates/ai_billing/src/outbound/pg_settlement_candidates.rs)):
  users with counted usage, payers whose anchored subscription period began or
  ended, and payers holding a credit reload reserved more than ten minutes ago
  that was never collected. A failure for one payer is logged and the sweep
  continues. Settlement is idempotent and serialized per payer on the account
  row, so replicas may sweep concurrently and the task is simply aborted at
  shutdown.
- **Closed periods.** `settle` no longer stops at the previous period. Before
  the open period it settles every period frozen within the last
  [`RECONCILED_CLOSED_PERIODS`](../crates/ai_billing/src/domain/service.rs)
  (three) periods, each against its own frozen allowance and keyed exactly as
  its ledger, oldest first. A frozen period ends where the next period
  begins. The derived previous period is settled (from the live entitlement,
  as before) only when nothing was frozen in its place, and the last frozen
  period then ends where it begins, so no usage is ever settled under two
  keys. Closed periods are settled from the credits on hand; automatic reload
  still applies only to the open period.

Automatic credit reload is part of the same settlement. It fires only inside
`BillingServiceImpl::settle`, so it shares the `ENABLE_AI_USAGE_BILLING` gate,
and only for the current period, before prepaid credits are consumed: while
automatic reload is enabled and not reload-suspended, settlement compares the
credit balance net of the period's
uncovered usage with the payer's minimum balance and, below it, reloads up to the
target balance. The minimum, target, and optional monthly spend limit are stored
per payer on `ai_billing_account` (defaults `$10`, `$100`, and no limit). The
monthly limit counts reloads Stripe may still collect (pending, paid, or failed
with an invoice) within the UTC calendar month, independent of the Stripe period
anchor; a remainder under the Stripe minimum charge is skipped. Each reload is one `ai_credit_reload` row reserved under the
payer lock and collected as a one-off Stripe invoice stamped
`macro_purpose = ai_credit_reload`; a paid invoice books an `ai_credit_ledger`
purchase, idempotent on the invoice id. A declined invoice stays pending, which
blocks further reloads, until the Stripe webhook reports it paid (credits are
booked) or failed (reloads are suspended). A provider failure marks the reload
failed and sets `auto_reload_suspended_at` until the payer saves their settings
again. Exhausted reload budgets, declined payments, and provider failures leave
unfunded usage uncovered. There is no direct-charge fallback or headroom from a
historical overage cap; when quota enforcement is enabled, exhausted allowance
and prepaid credits block new AI requests. A failed reload whose invoice reached
Stripe keeps that invoice, and the next reservation after reloads are re-enabled
retries it rather than opening a second one. `PATCH /ai-billing/auto-reload`
(payer on a paid plan only) enables automatic reloads: enabling validates and
stores the thresholds, sets the legacy `overage_enabled` reload opt-in field,
zeros the direct-charge cap, clears suspensions, and settles at once. Disabling
keeps the stored thresholds. The monthly reload budget must be at least `$5`.
`PATCH /ai-billing/overage` rejects attempts to enable direct billing; disabling
remains supported for older clients. New V1 funding snapshots also disable
postpaid authorization. Historical invoices retain their accounting and webhook
handling, but settlement never creates or retries direct charges.
`GET /ai-billing/summary`
reports `auto_reload` with the thresholds, `suspended`, and `active`.

The frontend is not tied to this flag. Settings → Usage and the shared usage-limit
dialog support all plans. Production activation follows the
`enable-ai-usage-billing` PostHog flag: while off or loading, Usage shows the
October 8, 2026 announcement with disabled controls and the dialog stays closed.
Dev and local stay active regardless of the flag. No backend rollout endpoint is
required. Foreground AI actions recognize the four quota
codes below; clients return typed errors, and presentation happens in the app's
mutation subscription or direct session/edit action handlers. Generic HTTP errors
and background queries do not open dialogs. Free refusals offer a paid plan;
paid refusals link to Usage settings. The monthly percentage uses
`GET /ai-billing/summary`; plan allowances use `GET /ai-billing/plans`.
Plan allowance copy and comparisons follow the `enable-ai-usage-billing` PostHog
flag (`enableAiUsageBilling` in `apps/web/src/lib/core/constant/featureFlags.ts`),
which defaults on in development builds and follows PostHog elsewhere;
`VITE_ENABLE_AI_USAGE_BILLING` overrides it locally. Model usage multipliers have
been removed. The Auto-Reload dialog saves through `PATCH /ai-billing/auto-reload`
and is the only surface that turns usage billing on.

## Public failure contracts

The [shared admission port](../crates/ai_billing/src/domain/admission.rs) returns
`Denied(DenyReason)` or sanitized `Unavailable`. Authorization runs first; quota
errors are not permission grants and must not disclose another user's quota.

| Result | HTTP status | Stable `code` | Retry semantics |
| --- | --- | --- | --- |
| Allowance exhausted | 402 | `ai_allowance_exhausted` | Policy/allowance must change; no automatic tight retry |
| Free monthly cap reached | 402 | `ai_free_allowance_exhausted` | Only an upgrade (or the next calendar month) lifts it |
| Spending cap reached | 402 | `ai_overage_limit_reached` | Policy/allowance must change |
| Overage payment failed | 402 | `ai_overage_payment_failed` | Billing problem must be resolved |
| Could not validate billing | 503 | `ai_billing_unavailable` | Retry later with bounded backoff; never execute on uncertainty |

The [common HTTP body](../crates/ai_billing/src/inbound/admission.rs) is
`{"error":"<public explanation>","code":"<stable code>"}`. The 503 explanation is
`AI usage validation is temporarily unavailable. Please try again.` Internal
reports are logged server-side, not serialized. A `Retry-After` header is not
promised by this mapping.

Cognition chat retains its existing `ChatMessageError` body, including
`stream_id: null` on admission failure and the optional `code` field. Structured
completion retains `StructuredCompletionError` (`error`, optional `code`). Both
return before stream/provider work; chat also checks before creating chat/messages.
Structured completion's agent and final formatting phases are one admitted
operation. Imports, session create/control, and manual scheduled execution use
the shared 402/503 body for synchronous admission errors. Session control also
retains its unrelated plain-text 503 for a draining replica with `Retry-After: 1`;
inspect the content type and code rather than assuming every 503 is billing.

### Tools, protocols, queues, and background work

- Subagent, native Anthropic tools, and AI editing return a failed tool result with
  the stable code and public explanation. These are tool/protocol failures, not
  necessarily HTTP 402/503 at the outer MCP transport. Do not treat an HTTP-success
  tool envelope as successful execution. No alternate provider is tried on refusal.
- Direct in-memory ACP prompts return protocol error `-32603`, the public message,
  and `data: {"code":"…","retryable":false}` for denial (`true` for unavailability).
  History and resumable state are preserved; rejected work never starts the engine.
- Harness admission applies at ingress **and dispatch**, including restored,
  forwarded, steered, and queued spending commands. A waiting command is not a
  reservation. On exhaustion, the waiting queue is durably removed before queue
  updates, failed announced-reply resolution, and
  `agent_session.command_rejected` lifecycle publication. Its
  [metadata](../crates/agent_session/src/domain/events.rs) contains `identity`,
  `action_id`, `actor`, optional `announcement_message_id`, and
  `failure: {code, message, retryable}`. It does not invent a runtime turn.
- Queue validation unavailability preserves FIFO work for a later ordinary
  queue-driving event, without a hot retry loop. Persistence failure retains work
  rather than announcing a rejection that was not saved. Retrying an already
  queued/in-flight action ID does not duplicate work or retroactively refuse the
  original turn. A rejected steering follow-up does not cancel the running turn.
- AI imports check before running/spawn and again when delayed AI work begins;
  failures clear running state and remain visible in import status. Deterministic
  connector fetches/import branches and status/dismiss/discard remain available.
- Scheduled model work checks the stored owner before resource preparation.
  Manual, cron, and event runs share the execution boundary; claims and failure
  bookkeeping are finalized even on refusal. Cron schedules advance; event failures
  are terminal bookkeeping, not automatic replay. Agent targets delegate funding
  decisions to the session/harness service. A 503 describes a retryable cause, not
  a promise that a scheduler or broker will redeliver the same run.
- Optional chat/session naming is independently admitted as ChatRename, an exempt
  feature, so the gate does no quota billing I/O and never charges the user; a
  refusal retains the existing/default title without failing successful primary work.
  Optional bot/trigger inference (including image captions) skips classification
  on failure, without AI fallback or implied approval. Explicit mentions still
  route deterministically; downstream execution has its own gate and failures.
- Repository selection is deterministic for an authorized explicit repository or
  a single candidate. Ambiguous model selection is AgentRepositoryChoice: refusal
  propagates instead of choosing a model fallback or silently approving work.
  Stop/cancel, reads, non-spending controls, and ordinary document operations remain
  available subject to their existing permissions.

## Trusted attribution and coverage matrix

Authenticated handlers/tool `RequestContext.user_id`, verified document edit
receipts, persisted scheduled-action owners, and persisted session owners are the
sources of attribution. Session collaborators are actors, not replacement payers.
Subagents/native tools replace the shared context's placeholder user with the
trusted caller and inherit the server's feature/entity. Never accept billing
identity, feature exemption, or `count_usage` from a client; never substitute
`SYSTEM_USER_ID` for a missing real caller. Non-user session owners remain rejected.

Macro-funded in-memory and managed sandbox sessions require AgentSession admission.
Cursor, Codex Cloud, Claude Cloud, and externally paired runtime execution is funded
externally and skips that gate; independently Macro-funded naming, repository
selection, and tool calls still have their own gates.

Links below identify the actual boundary, production injection/recorder constructor,
and local regression suite. They are not evidence of live-provider, browser, or
deployed coverage. Shared factory [R](../crates/ai_usage/src/lib.rs) means
`pg_recorder_with_enforcement`: configured analytics plus separate `pg_tracking`.
Shared tools [T](../crates/ai_tools/src/build_context.rs) construct configured
admission and take the host's recorder (R, or
[`pg_settling_recorder`](../crates/ai_billing/src/composition.rs) where the host
requests settlement). Admission itself never records usage or calls settlement.

| Surface / feature | Admission boundary | Production recorder / composition | Regression tests |
| --- | --- | --- | --- |
| Cognition chat / Chat | [chat handler](../services/document_cognition_service/src/api/stream/chat_message.rs) | [DCS main](../services/document_cognition_service/src/main.rs): configured `UsageServiceImpl` inside `SettlingUsageRecorder`, wrapped with `with_tracking` | [pre-creation refusal and permission precedence](../services/document_cognition_service/src/api/stream/chat_message/test.rs) |
| Structured completion / DynamicCompletionsApi | [completion handler](../services/document_cognition_service/src/api/structured_completion.rs) | DCS main, same recorder across both phases | [both phases and OpenAPI](../services/document_cognition_service/src/api/structured_completion/test.rs) |
| Chat naming / ChatRename | [chat renamer](../services/document_cognition_service/src/service/chat_renamer.rs) | DCS main, same recorder | [safe naming skip](../services/document_cognition_service/src/service/chat_renamer/test.rs) |
| Direct subagent / inherited feature | [operations service](../crates/ai_tools/src/ai_operations.rs), [subagent](../crates/ai_tools/src/subagent.rs) | Host common context: T, DCS main, or [MCP context](../services/mcp_service/src/context.rs) using `pg_settling_recorder` | [zero provider calls](../crates/ai_tools/src/ai_operations/test.rs), [concurrent caller isolation](../crates/ai_tools/src/subagent/test.rs) |
| Native Anthropic WebSearch/WebFetch/code tools / inherited feature | [invoke_server_tool](../crates/anthropic/src/toolset.rs) before both provider branches | Same common contexts via `FromRef`; observation only, **no legacy aggregate producer** | [tool attribution/refusal](../crates/anthropic/src/toolset/test.rs) |
| AI document editing / AiEditing | [document orchestration](../crates/documents/src/domain/ai_editing.rs) after verified edit receipt | Common context's recorder, existing per-model worker usage | [domain](../crates/documents/src/domain/ai_editing/test.rs), [direct tool and permission precedence](../crates/documents/src/inbound/toolset/edit_document/test.rs) |
| AI gather/Notion imports / Import | [import admission](../crates/import/src/domain/service/admission.rs), [execution/rechecks](../crates/import/src/domain/service.rs) | DCS main, wrapped recorder | [initial/retry/delayed/deterministic cases](../crates/import/src/domain/service/test/admission.rs), [HTTP](../crates/import/src/inbound/axum_router/test.rs) |
| Channel responder / ChannelBot | [bot service](../crates/channel_bots/src/domain/service.rs) | [DSS main](../services/document_storage_service/src/main.rs), common context T | [response refusal](../crates/channel_bots/src/domain/service/tests.rs) |
| Optional channel classification / ChannelBot | [trigger detector](../crates/channel_bots/src/domain/trigger_detector.rs) | DSS main, independent R for classifier | [explicit routing and inference skip](../crates/channel_bots/src/domain/trigger_detector/tests.rs) |
| Trigger inference and image captions / Automation | [trigger service](../crates/agent_trigger/src/domain/service.rs) | [standalone trigger main](../services/agent_trigger_service/src/main.rs) R; [harness trigger](../services/agent_harness_service/src/trigger.rs) receives the harness's settling recorder from harness main | [classification/caption refusal](../crates/agent_trigger/src/domain/service/test/admission.rs), [no system fallback](../crates/agent_trigger/src/outbound/fast_model_judge/test.rs) |
| Managed session ingress/dispatch/queue / AgentSession | [harness admission](../crates/agent_harness/src/domain/service/admission.rs) | [harness main](../services/agent_harness_service/src/main.rs): one `pg_settling_recorder` shared with T for in-memory; managed sandbox inference has **no `ai_usage` producer** | [owner, authorization, runtime funding, restart, queue rejection/outage](../crates/agent_harness/src/domain/service/test/quota.rs), [HTTP](../crates/agent_session/src/inbound/axum_router/test.rs), [event shape](../crates/agent_session/src/domain/events/test.rs) |
| Direct in-memory ACP/provider commands / AgentSession | [admit_turn](../crates/agent_inmem/src/domain/admission.rs), [agent execution](../crates/agent_inmem/src/domain/agent.rs) | Harness main → manager → `RigTurnEngine`, the harness's settling recorder passed into T | [direct ACP, queue, cancel, history](../crates/agent_inmem/src/domain/agent/test.rs), [manager](../crates/agent_inmem/src/outbound/manager/test.rs) |
| Session naming / ChatRename | [name generator gate](../crates/agent_session/src/domain/name_generation.rs) | Harness main, the same settling recorder for `HaikuAgentSessionNameGenerator` (exempt, so never counted or settled) | [fallback without provider calls](../crates/agent_session/src/domain/name_generation/test.rs) |
| Repository chooser / AgentRepositoryChoice | [repository choice service](../crates/agent_harness/src/domain/repository_choice.rs) | Harness main → `CursorContainerManager`, the same settling recorder | [deterministic bypass / typed model refusal](../crates/agent_harness/src/domain/repository_choice/test.rs) |
| Scheduled manual/cron/event model work / Automation | [shared executor](../services/scheduled_action/src/domain/execution.rs) | [scheduled service](../services/scheduled_action/src/bins/service.rs): `pg_settling_recorder` for the condition classifier; agent targets are funded and metered by the harness | [claims, schedules, terminal events](../services/scheduled_action/src/domain/execution/test.rs), [manual HTTP](../services/scheduled_action/src/inbound/axum_router/test.rs) |
| Scheduled agent targets / session funding policy | [target runner](../services/scheduled_action/src/domain/target_runner.rs) → session/harness admission | Target runtime's recorder, not duplicate scheduler metering | [delegation and typed errors](../services/scheduled_action/src/domain/target_runner/test.rs), [routine error transport](../crates/agent_session/src/inbound/routine_sessions/test.rs) |
| Memory, projection, call summary, dictation, chat rename / exempt | [shared admission policy](../crates/ai_billing/src/domain/admission.rs) skips quota; ordinary permissions still apply | DCS/DSS configured recorders; [memory context](../crates/memory/src/context.rs) uses T; DSS independent call-summary/dictation recorders use R | [all exempt features](../crates/ai_usage/src/domain/counting/test.rs), [no billing I/O](../crates/ai_billing/src/domain/admission/test.rs), [configured recording](../crates/ai_billing/src/composition/test.rs) |
| Existing system task duplicate judge / Automation | [system attribution](../crates/task_dedup/src/outbound/judge.rs), no user quota gate | DSS main, independent R; system events stay uncounted | [system counting](../crates/ai_usage/src/domain/counting/test.rs), [system recorder behavior](../crates/ai_billing/src/outbound/settling_recorder/test.rs) |
| Billing summary (not execution) | [billing service policy](../crates/ai_billing/src/domain/service.rs) | [authentication main](../services/authentication_service/src/main.rs) configures the same flag plus `ENABLE_AI_USAGE_BILLING`, no usage producer | [settlement policy/free/unlimited/settlement](../crates/ai_billing/src/domain/service/test.rs), [authentication configuration](../services/authentication_service/src/config/test.rs) |

## Limits and operational risks

- Snapshot checks do not reserve quota. Concurrent calls can all pass the same
  snapshot and overshoot. Already-started work may finish after exhaustion or a
  flag change; an admitted operation is not a strict maximum-cost authorization.
- Existing aggregate recording remains best-effort. Spawned writes, process exit,
  storage outages, absent provider counters, and paths recording only final success
  can lose usage. Admission fail-closed does not make metering durable.
- Managed sandbox inference is gated but is not metered into `ai_usage`. Native
  Anthropic tools write observations, not aggregate usage. External runtimes,
  remote MCP internals, and raw provider integrations are not made metered by
  injecting a common context. AI editing retains existing worker aggregates;
  dictation retains existing audio aggregates but is exempt. Neither is made
  complete per-attempt token evidence by this change.
- `ai_usage_observation` and `ai_financial_invocation` are separate accounting
  systems, not additional counted aggregates. Never sum them with `ai_usage` or
  replay observations into debt. Observation retention/erasure approval remains a
  deployment gate in the [observation rollout](AI_BILLING_ROLLOUT.md).
- Default-disabled constructors remain for internal/evaluation callers. Production
  must use configured admission and R (or explicitly configure DCS's inner usage
  service). A new producer must be audited at both its admission and recorder
  constructor; protecting its caller alone does not protect direct invocation.
- **Mixed true/false service configurations undercount usage and permit bypasses.**
  A false execution host skips admission, a false recorder writes uncounted rows,
  and a mismatched authentication host reports inconsistent blocking state. The
  flag is not safe for a staggered per-service activation.

## Safe rollout

No hosted configuration change or collection activation is authorized by this
procedure. Operators must approve and record each release gate.

1. **Compatible schema first.** Apply
   [the default-false column migration](../crates/macro_db_client/migrations/20260930145625_add_ai_usage_count_usage.sql)
   and [the concurrent partial-index migration](../crates/macro_db_client/migrations/20260930145626_ai_usage_counted_user_created_at_idx.sql).
   Keep the full analytics/old-service index. Verify historical rows and old
   inserts remain false. Verify `pg_index.indisvalid` and `pg_get_indexdef` for
   `ai_usage_counted_user_created_at_idx`: `(user_id, created_at DESC) WHERE
   count_usage = TRUE`. After interrupted concurrent creation, inspect validity;
   `IF NOT EXISTS` does not repair an invalid index. Follow the migration's
   operator-reviewed concurrent drop/retry guidance, not a database reset.
2. **Deploy all application changes with the flag false (or absent).** Include
   default-off admission, counted readers/writers, protocol/client contracts, and
   all host wiring before considering activation. Existing historical usage is
   no longer billed just because its feature is billable.
3. **Register `ENABLE_AI_USAGE_ENFORCEMENT` as raw `false` in Doppler for every
   participating service configuration**, including relevant environment variants:
   authentication, document cognition, document storage, MCP, agent harness,
   standalone agent trigger, and scheduled action. Include any separately launched
   memory/common-tool host. Use the existing Doppler-backed application config,
   not a quoted JSON string, AWS secret indirection, or a second Pulumi flag.
   The pricing values `AI_USAGE_FREE_INCLUDED_ALLOWANCE_CENTS`,
   `AI_USAGE_INCLUDED_ALLOWANCE_CENTS`, `AI_USAGE_MAX_INCLUDED_ALLOWANCE_CENTS`,
   and `AI_USAGE_OVERAGE_MARKUP_PERCENT` are mandatory for these same hosts
   whatever the flags say; see [Settlement](#settlement-enable_ai_usage_billing).
   Before `ENABLE_AI_USAGE_BILLING` is turned on for the agent harness, MCP, or
   scheduled action service, register `AUTHENTICATION_SERVICE_SECRET_KEY` (the
   authentication service's internal key, as document cognition already has it)
   in that service's Doppler config; those hosts refuse to start with billing on
   and the key absent.
   Verify the effective startup value for every replica/worker. Registration and
   hosted access require operator approval; code defaults are not proof of it.
4. **Validate locally, then in an approved staging environment.** Use the checklist
   below and review counts, index plans, failure rates, queue cleanup, and known
   metering gaps. Confirm missing/false/true/invalid parsing and that settlement
   stays suppressed while `ENABLE_AI_USAGE_BILLING` is false. Validate the
   observation privacy gate too.
5. **Coordinated, operator-approved enablement only.** Record participating hosts,
   deployment versions, approved environment/time, monitoring owner, and rollback
   decision. Coordinate configuration and restart/redeploy so traffic does not
   rely on mixed-policy replicas; drain/pause affected work if needed. Check actual
   startup policy, 402/503 behavior, new counted rows, summaries, and background
   queues before declaring activation complete. This enables legacy quotas, **not
   credit collection or Stripe settlement**; those need `ENABLE_AI_USAGE_BILLING`
   registered and enabled for the authentication service (which then also runs
   the reconciliation sweep) and for the document cognition, agent harness, MCP,
   and scheduled action services, with their authentication key registered.

### Rollback

Set the flag to raw `false` **consistently across all participating configurations**
and restart/redeploy the affected processes. Verify admission bypass and new
uncounted writes. Do not roll back the additive schema, drop the indexes, erase
counted history, or rewrite recorded booleans. Never backfill historical rows.
Previously counted usage remains counted (and will still be present when
re-enabled in the same period); disabling is not a quota reset. Already-started
operations can finish using their process's startup policy.

## Validation checklist

Use disposable local fixtures and no hosted customer data. These are release
checks, not a claim that a particular deployment has passed them.

- Generate only from local Rust binaries:
  `bun run --cwd apps/web gen-api document-cognition agent-harness scheduled-action cloud-storage`.
  Repeat with `gen-api --check`. Run `bun run --cwd apps/web check`, `just check`,
  `just check full`, and `just rust-check`. In a jj-only checkout the current
  generator freshness/check scripts use Git discovery; a discovery failure is
  not a passing check. Compare two generated trees for determinism and run direct
  scoped checks when blocked; record the limitation.
- Run the matrix's affected Rust packages individually from the repository root
  with `SQLX_OFFLINE` unset; use [database setup](DATABASE_DEVELOPMENT.md).
  Include `ai_usage`, `ai_billing`, and composition tests. Test counted/uncounted,
  historical/default rows, multiple users/seats, period boundaries, null totals,
  repricing stability, and partial-index eligibility on representative local data.
- With missing/false configuration, prove zero admission billing-port calls and
  uncounted writes. With true, use allowed paid, exhausted, free/unlimited, exempt,
  system, and unavailable-billing fixtures. Refusals must make zero provider calls.
  Check each matrix boundary, not just chat, and test unauthorized requests first.
- Enqueue while allowed, exhaust before dispatch, restore after restart, and check
  durable rejection/reply cleanup. During billing outage preserve queued work
  without spinning. Retry existing action IDs without duplication. Check import
  running flags and scheduled claims/finalization, plus cancellation during admission.
- Start an isolated stack with
  `nix develop --command just run_local --instance ai-quota`. Use local identities
  and billing fixtures. Perform the [AI chat manual checks](AGENT_GUIDE/ai-chat.md#quota-manual-checks):
  no orphaned chat/stream on refusal, direct AI edit failure, observable queue
  rejection, usable cancellation, and recovery after consistently disabling.
  A frontend against hosted dev cannot validate these local backend changes.
- Record actual command results, browser observations, index timing/plans, and
  environment blockers in the release handoff. Do not infer live Doppler state,
  provider coverage, privacy approval, or production payment suppression from a
  generated schema alone. No upgrade-prompt UI is added by this rollout.
