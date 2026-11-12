# Rox enterprise recovery specification

## Request and evidence boundary

- Current request: read the interrupted OMP session and resume all of its unfinished tasks concurrently in parallel.
- Session source: `/var/folders/dp/lbmf8rn9481fygd3687q6dvw0000gn/T/omp-llm-request-15caa5cf7db3ee4f.json`, SHA-256 `fbaa00b46ed4917a497b69cc0307b6128866753c0c8ed39f21394a5ef38f6065`.
- Canonical functional acceptance remains `/Users/t/Projects/macro/prompts/00-axioms.md` through `04-enterprise.md`; this document indexes, rather than replaces, those prompts.
- Code baseline: `28565446c8ee2933c5709f67bd8db65ba4a4dce4` on `integration/rox-enterprise`, which contains the four feature branches.
- Mode: execute locally, verify, integrate, and commit on the integration branch. Do not push, open a PR, deploy, touch production, edit `main`, or read/write secrets.
- The old session's completion declarations are not evidence. Its reported 48 email-service failures, missing rebrand checks, enterprise-only integration tests, and unresponsive Vite server must be reproduced or closed against the current trees.

## Stable requirement ids

The source prompts do not assign FR/SC ids. The ids below are assigned by this recovery pass in task/document order.

| Requirement | Acceptance | Owner lane |
| --- | --- | --- |
| FR-001 Rox display | Rox/rox.one/rox-one display constants, titles, manifests, docs, mail footer, MCP display title, and local OAuth display name use the shared brand source without renaming wire identifiers. | frontend |
| FR-002 Legal and wire fence | `LICENSE.txt`, `apps/web/LICENSE`, `macro|` ids, bundle ids, service hostnames, Kafka topics, package scopes, cookie/storage keys, and staff domain remain unchanged; one linked modification notice names the source fork. | frontend |
| FR-003 Assets and truthful copy | Required Rox icon derivatives exist; `Sent with Macro` is gone; marketing/docs make no unsupported Rox SAML, SCIM, SSO, compliance, self-host, or EU-hosting claims. | frontend |
| FR-004 Handle signup | `ada` passes; `ab`, `admin`, `ada` with the first-party domain appended, and `..ada` fail; uniqueness is case-insensitive; duplicate handle is rejected rather than suffixed; existing `macro|email` users still resolve. | mailbox |
| FR-005 First-party primary mailbox | New `ROX` provider/link for the claimed handle at the first-party domain is primary; no-link `/email/init` does not call Gmail; later Gmail/Outlook links are optional and non-primary unless explicitly promoted. | mailbox |
| FR-006 Native Drive and import copy | Existing Document storage/key shape is unchanged; native files are Drive and third-party Google Drive/Dropbox/OneDrive/Box entries are imports, with no new bucket/table/sync engine. | mailbox + frontend |
| FR-007 Honest provisioning boundary | Server-side provision adapter uses the existing contract and fake HTTP tests only; no public mail call, persisted/logged mailbox password, invented token, or second mail server; missing broker exchange remains `identity_gap`. | mailbox |
| FR-008 OMP local runtime | `omp` preset launches `omp acp`; detection reports resolved local presets and omits unresolved binaries without failure; existing presets remain registered and no webview launcher is added. | enterprise-runtimes |
| FR-009 Workspace and policy preservation | Session cwd equals workspace, existing ACP/MCP attachment is retained, `autoAccept` is not enabled, no real model call is required, and preset docs are accurate. | enterprise-runtimes |
| FR-010 Identity binding | New binding storage enforces unique user/account/handle without token/password columns; production broker adapter returns typed `broker_exchange_gap` without network success. | enterprise-runtimes |
| FR-011 Soft member disable/enable | Admin disable uses `deactivate_user` (never hard delete), blocks new email init and agent sessions, preserves documents/chats/mail, and reports `mail_suspend_gap` plus any `harness_revoke_gap`; enable reactivates. | enterprise-runtimes |
| FR-012 Append-only audit | Committed login, invite, share-link, mailbox provision, agent-session start, disable, and enable actions produce one actor/action/resource/result/time row at the persistence boundary with no secrets or content. | enterprise-runtimes |
| FR-013 Runtime allowlist and billing meaning | Absent allowlist preserves current behavior; present list denies unknown/cloud/non-listed presets and records the chosen preset; `team.enterprise` remains seat billing and disable does not consult it. | enterprise-runtimes |
| FR-014 Safe schema and generated artifacts | New migrations preserve existing CRM consent behavior and rolling-deploy compatibility; workspace SQLx metadata is regenerated only through `just prepare_db`; no crate-local/manual cache or destructive reset is used. | mailbox |
| FR-015 Integrated product verification | All four branches integrate without dropping requirements; affected package tests, `just check`, generated-artifact checks, and real browser behavior run at the final integrated revision; independent review covers the original prompts. | integration + verify |
| FR-016 Local frontend recovery | The previous empty HTTP/TLS failure is root-caused; a supported local frontend serves `/app/` and is exercised in a browser, or the exact external/hosted-service prerequisite is reported without claiming readiness. | frontend + verify |

## Explicit non-goals and preserved gaps

- No SAML, SCIM, custom customer mail domain, legal hold, retention/DLP rollout, public hosted-enterprise claim, production mailbox suspension, or live broker-token exchange.
- No repo-wide Macro identifier rename, second mail/file stack, replacement ACP/runtime protocol, or webview CLI spawn.
- No database/volume reset, history rewrite, `git stash`, deployment, push, or production action.

## Completion condition

Every FR row links to a task and fresh evidence at the final integrated commit. Required failures are either fixed with a pre-fix red witness or explicitly remain open with their exact external prerequisite. A separate verifier, not a producer, judges the whole goal; independent review findings remain visible until re-checked on the revised commit.
