# Workspace HIPAA safeguards — release review

Status: **draft implementation; not approval to process PHI.** No workspace is
eligible by default. Do not populate `team_privacy.hipaa_approved_at` until the
technical blockers and operational review below are complete. This field is not
editable by a customer, including a paying owner. Payment alone is not approval.

## Product and API

Team settings contains **HIPAA safeguards**. Free workspace admins see **Upgrade
for HIPAA**, which opens Billing. Paid admins/owners can enable the setting only
after Macro approves readiness. Members can view the status but cannot change it.
Disabling requires confirmation. A billing downgrade never automatically disables
existing protection and does not prevent an admin explicitly turning it off.

`GET /auth/privacy` returns the authenticated user's current workspace, state,
readiness, paid eligibility, admin role and revision. `PATCH /auth/privacy` accepts
`{ "enabled": true, "expected_revision": 0 }`. The server derives the workspace
from the authenticated user; it accepts no arbitrary workspace id. Writes recheck
membership/role/payment under row locks, check the revision, and commit a minimal
audit record with the setting. Responses are `no-store`. Rejections: 403 role,
402 payment, 412 readiness, 409 stale state, 503 policy unavailable.

## Implemented controls

| Surface | Behavior | Code |
| --- | --- | --- |
| APNs via SNS | Rechecks policy at delivery, including retry/fallback paths. Creates a new payload with fixed text and an opaque notification UUID only. Drops names, previews, avatar/attachment URLs, localization arguments, categories and original grouping keys. Omits mutable-content so the native extension cannot enrich the alert. Background clears stay silent. | `crates/notification/src/domain/service/privacy.rs` |
| Source/recipient checks | Reads current device owner, persisted sender and notification recipients. A missing notification/device or lookup failure cannot authorize a rich push. Billing is never consulted to decide whether an enabled protection still applies. | `crates/workspace_privacy/src/outbound.rs` |
| VoIP/Android | Legacy paths lack sufficient source provenance. With any protected workspace present, withhold these pushes rather than send names or LiveKit bearer credentials. VoIP reports failure to the caller; no fake successful receipt. | `PrivatePushSender` |
| Notification email/digests | Same last-mile guard for immediate and digest email; uses generic fixed text when protection applies. No preview, tracking image or content URL in the replacement body. | `PrivateEmailSender` |
| Browser/desktop OS notifications | Replaces title/options with fixed text while policy is unknown or protected. Original icon/image/data/tag are not passed to the OS. | `PlatformNotificationProvider.tsx` |
| Browser analytics | Defers PostHog, Google/GTM and Meta SDK initialization until an authenticated policy read explicitly allows it. Capture APIs check permission. Revocation stops replay/capture, revokes consent and keeps the page closed until reload. | `apps/web/src/lib/analytics/analytics.ts` |
| Feature flags | Disabled PostHog resolves flags using existing off/fallback behavior, avoiding an indefinite flags-loading spinner. Flag-dependent product availability still needs acceptance testing. | `posthog.tsx` |
| Browser Datadog/OTLP | Waits for privacy permission before initialization and rechecks permission when each queued trace/log batch exports. Revoked batches are discarded rather than flushed. | `packages/observability/src/disclosure-exporter.ts` |
| Server analytics | Shared PostHog/Meta client checks current policy immediately before sending. Team events also check their source team so removing a member does not make a team-leave event eligible. Unscoped GA events are withheld while any protected workspace exists. Lookup failures drop optional analytics. | `crates/analytics_client/src/lib.rs` |
| Diagnostics | Stops logging whole queued delivery messages. GenAI prompt/tool/result capture defaults to off; invalid capture-switch values also mean off. Does not remove operational security audit records. | `crates/genai_telemetry/src/content.rs` |

## Technical release blockers

These are known gaps, not a declaration that all other paths are safe.

1. **Source ownership must survive sharing, bots and membership changes.** The
   current notification policy can see recipients/sender membership, not a durable
   PHI classification of the underlying entity. Cover guest access, shared links,
   personal items owned by members, bots acting for users, user removal, team
   deletion and moving items. Define whether protections follow the workspace,
   the data, or every account that has accessed that data. Carry the resulting
   policy through queues, search, agents and attachments. Do not use a recipient's
   free plan or departure as permission to disclose protected source content.
2. **Legacy unscoped paths currently use conservative global suppression.** When
   any workspace is protected, notification emails become generic for everyone,
   and VoIP/Android plus unscoped GA events are withheld. Server analytics for
   identities without workspace membership also use this conservative fallback. This is deliberately
   safe but has a cross-customer product impact. Before general release, add
   trustworthy source workspace/provenance to each email/digest/VoIP envelope and
   test mixed-workspace delivery. Decide whether native background incoming-call
   support is required; it needs an authenticated retrieval design that does not
   transmit a LiveKit bearer credential through APNs.
3. **Active and old clients.** The initiating tab stops analytics before enabling
   and reloads after success. Other current tabs poll every ten seconds and on
   focus; that is not an instantaneous server-enforced boundary. Old builds do
   not honor the policy. Add an authenticated intake policy at `analytics-proxy`
   and an enforced minimum client version/session invalidation strategy. Validate
   queued PostHog requests, recorder buffers, cookieless modes, GA/GTM behavior and
   Meta scripts already loaded before activation. PostHog opt-out persistence
   must be reconciled before promising automatic analytics resumption after
   disabling; this implementation never overrides an existing opt-out. Anonymous
   browser sessions also remain untracked because they cannot establish workspace
   policy. Existing delivered notifications
   and historical vendor data cannot be recalled by this setting.
4. **Server logs/traces beyond GenAI.** Request arguments, user ids containing
   emails, URLs/query strings, parser/provider error messages and job payloads
   occur across services. Examples requiring review include
   `services/email_service/src/pubsub/{gmail_ops,inbox_sync}/error_handlers.rs`,
   `services/convert_service/src/process/convert.rs`,
   `services/document_upload_finalizer_handler/src/inbound/local_sqs.rs`,
   `services/{image_proxy_service,unfurl_service}` and native diagnostic logging.
   Use an allowlist of content-free diagnostic fields with policy propagation;
   inventory Datadog agents, collectors, CloudWatch, Cloudflare and SDK auto
   instrumentation. Set `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false`
   everywhere PHI can flow, including harnesses. An explicit true overrides the
   safer default and is not acceptable on a shared PHI-processing deployment.
5. **Non-analytics subprocessors and optional egress.** Review/allowlist or block
   Loops marketing sync, Apollo CRM enrichment, Pipedream/MCP connectors, external
   agent tools/webhooks, external model endpoints, transcription/LiveKit, email
   providers, OCR/conversion, link unfurling and remote images. The workspace
   setting does not yet enforce these paths. Relevant owners include
   `crates/{loops_client,crm,agent_egress,agent_harness,pipedream_mcp,call}` and their
   composition roots. A BAA is specific to the contracted service/account and
   configuration; a vendor name alone proves nothing.
6. **Storage and access.** Verify tenant isolation, public/team link defaults and
   revocation, least-privilege API keys and service credentials, authentication and
   session controls, local IndexedDB/Turso/native caches, encryption and key
   management, backups/restores, retention/deletion and audit-log access. Do not
   silently erase access/audit records in the name of minimizing analytics.
7. **Acceptance and migration.** Run the full affected Rust services/tests against
   the actual migrated MacroDB schema, regenerate the full SQLx cache in the Nix
   workflow, and test web/desktop/iOS with network inspection. Include denied
   member/free/non-ready requests, optimistic-concurrency conflicts, downgrade,
   enable/disable/reload, stale tabs, offline/reconnect, queued/retried sends,
   fallback digests, rich extensions, VoIP and all enabled feature flags. Verify
   client-generation coverage for the documented OpenAPI privacy endpoints. Deploy
   schema first, guards everywhere next, and eligibility only after verification.

## Operational decisions/evidence

- Executed customer BAA and an approved subprocessor/service/account inventory.
- Security risk analysis covering all ePHI flows; designated owners for remaining
  technical fixes and for ongoing review of new integrations and telemetry.
- Access review, workforce procedures/training, incident response and breach
  notification processes, backup restoration evidence, retention/return/deletion
  procedures, and monitoring that preserves necessary audit evidence.
- A reviewed customer promise: supported features, restrictions, responsibilities
  and what disabling safeguards means. Avoid marketing this switch as a HIPAA
  certification.

After review, operations may provision a `team_privacy` row and set its
`hipaa_approved_at` using the existing controlled administrative database workflow.
Record the approval evidence in the compliance system. This PR intentionally
provides no customer-facing way to grant that approval. Do not enable a workspace
as a way to test production readiness.

## Basis

Apple advises excluding sensitive customer information from notification payloads:
[Apple notification payload guidance](https://developer.apple.com/library/archive/documentation/NetworkingInternet/Conceptual/RemoteNotificationsPG/CreatingtheNotificationPayload.html).
HHS requires the applicable safeguards, risk analysis and BAAs for cloud services
handling ePHI; encryption alone does not remove a cloud provider's obligations:
[HHS cloud-computing guidance](https://www.hhs.gov/hipaa/for-professionals/special-topics/health-information-technology/cloud-computing/index.html).

## Validation in this PR

- All affected services compile with `SQLX_OFFLINE=true cargo check`: authentication,
  document storage and notification services, plus notification, analytics and the
  workspace privacy crate (including the inbound feature and OpenAPI annotations).
- Workspace domain authorization tests: 3 pass. GenAI content-policy/size tests:
  13 pass. Full GenAI suite has unrelated span/export failures (20 pass, 2 fail
  in a serial run); these are unresolved, not claimed to be baseline failures.
- Five new notification privacy tests pass in an isolated temporary harness
  against the compiled notification library and the same privacy implementation/
  test files: queued delivery after enablement, policy lookup failure, exact APNs
  payload allowlist, silent background clears, email redaction and VoIP withholding.
  The normal notification unit-test target cannot compile here because existing
  repository test-only SQLx queries lack cache entries and no full MacroDB is
  running. This harness does not replace database/integration tests.
- Frontend and observability type checks, analytics revocation tests (2), queued
  OTLP exporter revocation test (1), formatting/lint checks pass.
- Eight changed SQLx queries were reviewed: all are compile-time macros with bind
  parameters. Membership/entitlement/revision predicates and atomic auditing were
  checked; no SQL interpolation. Cache files were generated by the SQLx CLI
  against a temporary PostgreSQL-compatible schema fixture plus the real migration.
  `just prepare_db` is blocked because Nix/full MacroDB are unavailable. Run the
  canonical full-schema preparation and migration/concurrency tests before merge.
- Real-browser verification is blocked: the cloud browser rejected the local
  synthetic fixture under its URL security policy. No end-to-end web/native or
  production network inspection is claimed.
- Hexagonal boundaries checked: inbound forwards authenticated identity to the
  domain service; authorization and entitlement policy live there. The SQL
  adapter rechecks those invariants atomically; disclosure wrappers depend on a
  policy port rather than storage or provider-specific implementations.
