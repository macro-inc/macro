# team_agents

## What it is

Agent teammates (docs/design/agent-brains.md): AI teammates that are real
Macro accounts on a team, each on its own Macro computer. This crate invites
one and buys its computer in one step, and serves the agent's own profile and
email over `/team_agents` in the auth service.

## How it works

Creation uses `AccountHolderOrInternal`: account-manager credentials may not
provision lasting agent credentials. Retry reuses the computer and non-secret seed; the fleet issues fresh
credentials only when it actually creates or recreates an unclaimed guest.

`POST /team_agents` (team admins using their own credential, `enable-team-agents`) → validate → mailbox
→ account rows + `team_agents` row (one transaction, `"User"."isAgent"`) →
`TeamService::add_team_agent` (joins without a Stripe call; returns the seat
item) → workspace repo (`agent_git`) → `Computers::purchase`
with the persona and the seat item, so seat and computer share one Stripe
update. Failures known to precede billing undo the repo, membership, account
and mailbox. Repository creation failures return a safe server reason explaining
that nothing was charged; detailed provider errors stay in server logs. Purchase errors recover the durable computer ID from the team's
saved agent persona. Its payment outbox resolves unknown outcomes idempotently;
the agent remains `provisioning` with pending payment and forwards the computer
service’s creation progress.
A definite `payment_failed` computer retains its agent as `failed` with reason
`payment failed`. The response exposes durable `payment` (`pending`, `paid`,
`unbilled`, `comped`), or null when its computer cannot be read. The agent exists and its
`status` (`provisioning` → `running` | `unhealthy` | `failed`) is refreshed from the
computer on `GET /team_agents` and `GET /team_agents/me`.

`running` requires a Ready computer and its enrolled persona's healthy harness
report. Reports are live only while the harness is connected and `checked_at`
is no more than two minutes old (future observations are rejected). A Ready
computer with unhealthy, missing, disconnected, stale or unavailable health is
`unhealthy` with `statusReason: "unhealthy: <diagnostic>"`. Before the first
connection, setup progress takes precedence: a disconnected harness stays
`provisioning` at `connecting` ("Connecting agent"). Other non-failed computer
states remain `provisioning`; sleeping/stopped computers are not running agents.
`lastTurnAt` carries the persona's last reported completed turn, including from
unhealthy/missing reports. It is computed from harness capabilities, not stored
in the team-agent row. Transient health diagnostics exist only in the response; the stored row keeps
the underlying `running` state with no reason. Only terminal computer/payment
outcomes persist `failed`. A failed status lookup preserves provisioning or
returns transient `unhealthy` for a previously running agent, without writing a
failure. Every refresh recomputes health and clears diagnostics on recovery.

`GET /team_agents/sizes` returns the hosted-runtimes size catalog to any team
admin with the rollout enabled, without consulting billing. Use it for the size picker.
`GET /team_agents/quote?size=` returns HTTP 409 with `code: "no_subscription"`
when the team lacks an active subscription; other conflicts have their own
`computer_unavailable` or `retry_unavailable` codes. The quote includes `vcpus`, `memoryGb`, and `diskGb`
from the hosted-runtimes size catalog alongside the seat and computer price.

The current verified primary emails of the team owner and administrators are
checked against `TEAM_AGENTS_INCLUDED_EMAIL_DOMAIN` (explicit configuration;
empty disables; exact, case-insensitive domain match). Matching teams get an `included: true` quote with
zero seat and computer totals, without a subscription lookup. Create joins the
agent without a seat item and uses `Computers::provision_comped`; deletion uses
the computer’s durable Comped payment outcome to remove membership without a
Stripe decrement. Eligibility never uses the actor’s address or team name. The required create field
`expectedIncluded` carries the reviewed quote’s mode; a changed mode returns
409 `quote_changed` before any resource or charge is attempted.
The hosted adapter passes `PurchaseBilling::Comped` with reason
`Included for Macro` and no extra items. It never substitutes a billed purchase.
The authentication service also applies this shared eligibility policy to direct
team computer purchases through `MacroStaffCompPolicy`.

The `enable-team-agents` rollout gates management operations: roster, voice
discovery/samples/settings, sizes, quote, create, retry and remove. Load one snapshot for the authenticated user and read it synchronously.
Computer discovery uses the canonical `ComputerRollout` instead: it loads one
snapshot of `enable-macro-computers` and never checks `enable-team-agents`.
Missing computer-rollout configuration or evaluation failure denies discovery;
management retains its separate gate.
Missing configuration, a missing key, off or load failure denies with HTTP 403.
Team authorization remains independent. Agent self profile/mail, brain gateway
and git access never consult this rollout policy.

## Start here

- `src/domain/service.rs`: the create flow, undo, delete, and the persona
  (`config_keys` lists the config drive values the brain reads).
- `src/domain/ports.rs`: the `Computers` and `AgentRepos` contracts.

## Scope

- `GET /team_agents/{agent_user_id}/computer` uses the independent
  `enable-macro-computers` rollout and permits enabled teammates
  to discover only their team's bound computer and nullable harness ID, with
  `isAgentComputer: true`. It returns no profile, billing or bootstrap details
  and grants no runtime access. The roster stays administrator-only.

- Owns: the `team_agents` table, agent account creation and deletion, the
  persona sent to the computer, agent email.
- Not here: membership and seat pricing → `crates/teams`; computers →
  `crates/hosted_runtimes`; repos → `crates/agent_git`.

## Checks

- `cargo test -p team_agents --all-features` (`SQLX_OFFLINE` unset).

## Gotchas

- Reuse canonical `ComputerId`, `ComputerSize`, `HostId` and `HarnessId` across
  domain/adapter boundaries; unwrap UUIDs only for SQL or external repositories.
  Do not introduce duplicate computer identity or size types.

- Reuse `hosted_runtimes::domain::enrollment::{Persona, PersonaService,
  PersonaOsUser, SystemdUnitName, PersonaConfigKey}` and
  `stripe_price_id::StripePriceId` at domain/adapter boundaries. Construct
  generated `agent-` usernames before provisioning effects. The canonical
  persona parser permits generic Linux names; team-agent recovery and enrollment
  enforce the stricter `agent-` policy before effects. Local preview agents with
  old names require re-inviting.

- API keys and repository credentials use distinct validated `AgentApiKey` and
  `RepoToken` types from `agent_credentials`; never wrap arbitrary strings or
  log their contents. Never persist them in a persona, lifecycle state, outbox or saved seed.
- The config file `/etc/macro/personas/<os_user>.env` holds the bootstrap
  credentials: `MACRO_API_KEY` (also `ANTHROPIC_AUTH_TOKEN`) and the repo-scoped
  `MACRO_REPO_TOKEN`. Write it with mode 600, owned by `os_user`.
- Require the `agent-` prefix on every persona OS user, including stored enrollment
  input. Local preview agents created with old names must be re-invited; no legacy
  persona-name type or implicit OS-user migration is supported.
- Run `/opt/macro/brain run` as the name-derived OS user, with `MACRO_GATEWAY`,
  `BRAIN_WORKSPACE=/home/<os_user>/workspace`, `BRAIN_HEALTH_PORT=7801`,
  `MACRO_REPO_URL`, `MACRO_REPO_TOKEN`, `MACRO_AGENT_USER_ID`, `MACRO_API_KEY`,
  `ANTHROPIC_BASE_URL=<egress>/brain/anthropic`, and `ANTHROPIC_AUTH_TOKEN`
  in the one-time enrollment env. The Anthropic token is that agent's own revocable API
  key, reused from `MACRO_API_KEY`.
- `outbound/hosted_runtimes_computers.rs` calls `ComputerService` in process;
  its purchase forwards the persona and seat in `extra_items` for one Stripe
  update. Tests keep the fake `Computers` port. The persona (name, job,
  personality) is written into the repo's `OPERATING.md` by `agent_git`.
- The computer adapter reads health through the harness domain repository using
  the saved computer's `harness_id`, matching team ownership, computer identity,
  and the enrolled persona OS user; it never reads another persona's report.
- Quote reports billing-provider outages as 502. Saved purchases retain their
  agent and non-secret persona through payment resolution. Provider details
  are never exposed in the agent's failure reason.
- Delete runs computer → repo → seat → mailbox → account; the row goes last
  so a retry after a partial failure still finds the agent.
- Keep mailbox, message and thread IDs validated before storage or provider URL
  construction; email-provider IDs remain strings in JSON.
- Without `DEAD_SIMPLE_MAIL_API_KEY` agents get an `@agents.macro.invalid`
  placeholder address and the email routes answer 503.
- The brain reaches Macro through the typed public gateway and git URLs in
  deployed environments. Local bootstrap uses `COMPUTERS_SERVICE_URL_OVERRIDES`:
  Docker uses the proxy's internal HTTP listener and service-network git/egress;
  Incus uses bridge addresses through reverse tunnels. Keep internal repo API
  calls separate from the computer-facing clone URL. Local guests need no host
  DNS entries, local CA import or TLS bypass.

## Related

- Rules: `.agents/rules/rust/security.md` · Docs: `docs/design/agent-brains.md`

## Provisioning recovery

`POST /team_agents/{agent_user_id}/retry` requires a team admin receipt and checks
that the agent belongs to that team. Pending or unbilled payments return 409;
other non-failed computers return their current agent unchanged. `retryable` is
true only for failed computer provisioning with a paid purchase;
pending payments, payment failures, released computers and brain-health failures
do not offer Retry. A `payment_failed` retry returns 409 before repo recovery;
admins release that agent or re-invite. Deletion returns 409 while payment is
pending. Hosted runtimes' durable payment fact survives release and partial
deletion: membership undo removes an unbilled agent without decrementing a paid
seat. Paid deletion releases the computer and removes the billed agent seat.
Failed computers reuse the saved computer ID and `team_agents.persona_seed`;
recovery never buys another computer, adds a seat or creates an account. The
fleet's `PersonaCredentialSource` calls the auth service's InternalOnly
`POST /internal/team_agent_enrollment/{computer}/{generation}`. Each issuance
rotates the agent's named Brain key with `replace_key` and reissues its repository
token while preserving existing repository contents. Only hashes are persisted.
Missing repos are reseeded from the saved inputs. The original creator is recovered
from `created_by` when an older seed lacks it.

Computer facts come through hosted runtimes' `ComputerRepo`; this crate reads
only its own account binding and rechecks the generation after locking the agent.
The auth service holds the agent row lock across both providers. If the fleet
runs before the invite handler saves its computer ID, it atomically claims only
the matching unbound agent on that computer's team; it never replaces another
computer's binding. Stale generations and mismatched accounts fail closed.
The fleet owns claimed-generation checks: a live claimed guest never re-keys;
an unclaimed retry rotates again, and a recreate advances the generation.
The returned `PersonaEnrollment` is transient, redacted and zeroizing. The three
bootstrap env values are written only to the guest's mode-0600 file before claim.
Retry errors retain the agent for another attempt. No stored plaintext is reused.

`PendingPayment` is durable before Stripe and has no reservation-expiry timer.
Hosted runtimes replays its original payment effect with the original idempotency
key and extra seat item. Status refresh follows these phases without an
agent-side reconciliation override or a second purchase. If identity recovery
or saving the computer link fails, the retained agent remains provisioning with a
link-recovery reason. Retry and delete require that missing link to be recovered
first, preserving the account, credentials and repo while payment may resolve.

## Standalone brain gateway

`domain/gateway.rs` owns API-key eligibility, agent membership and computer
ownership policy. The outbound directory validates revocable user keys and reads
agent/team facts through the existing domain ports. Only a registered team agent
with its own Running computer may use `/brain/anthropic`; Frozen wake must finish
before authorization succeeds. Ordinary user keys never qualify. The harness
service shares session admission, model allowlisting and metering, attributing
usage to the agent and its current team.

Trace invite phases under the caller, record `billing_kind` as stripe/comped,
and hash email-bearing agent user IDs with `macro_user_id::telemetry_id`.

## Call voice ownership

Voice settings, catalog, metered samples and roster reads require a team
administrator receipt. Creator identity never grants management access;
computer create/retry/delete also stay admin-only. Provisioning persists the selected
voice in the saved persona seed. Voice updates call the agent git port, which
commits only `config/voice.json`; no settings database column is needed.
The harness owns the provider catalog and fixed-line sample cache. Discovery
requires team administration and the enabled management rollout; changing an
agent's voice also checks that it belongs to the receipt team.
