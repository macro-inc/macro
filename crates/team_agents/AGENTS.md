# team_agents

## What it is

Agent teammates (docs/design/agent-brains.md): AI teammates that are real
Macro accounts on a team, each on its own Macro computer. This crate invites
one and buys its computer in one step, and serves the agent's own profile and
email over `/team_agents` in the auth service.

## How it works

`POST /team_agents` (team admins, `enable-team-agents`) → validate → mailbox
→ account rows + `team_agents` row (one transaction, `"User"."isAgent"`) →
`TeamService::add_team_agent` (joins without a Stripe call; returns the seat
item) → user API key → workspace repo (`agent_git`) → `Computers::purchase`
with the persona and the seat item, so seat and computer share one Stripe
update. Failures known to precede billing undo the repo, membership, account
and mailbox. Repository creation failures return a safe server reason explaining
that nothing was charged; detailed provider errors stay in server logs. Purchase errors recover the durable computer ID from the team's
saved agent persona. Its payment outbox resolves unknown outcomes idempotently;
the agent remains `provisioning` at setup step `paying` ("Confirming payment").
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

The `enable-team-agents` rollout gates every administrator operation: roster,
sizes, quote, create, retry, remove and admin secret list/delete. Load exactly one
snapshot for the authenticated administrator and read the flag synchronously.
Missing configuration, a missing key, off or load failure denies with HTTP 403.
Team authorization remains independent. Agent self profile/mail, own secrets,
brain gateway and git access never consult this rollout policy.

## Start here

- `src/domain/service.rs`: the create flow, undo, delete, and the persona
  (`config_keys` lists the config drive values the brain reads).
- `src/domain/ports.rs`: the `Computers` and `AgentRepos` contracts.

## Scope

- Owns: the `team_agents` table, agent account creation and deletion, the
  persona sent to the computer, agent email.
- Not here: membership and seat pricing → `crates/teams`; computers →
  `crates/hosted_runtimes`; repos → `crates/agent_git`; secrets →
  `crates/agent_secrets` (this crate implements its `TeamAgentDirectory`).

## Checks

- `cargo test -p team_agents --all-features` (`SQLX_OFFLINE` unset).

## Gotchas

- API keys and repository credentials use distinct validated `AgentApiKey` and
  `RepoToken` types from `agent_credentials`; never wrap arbitrary strings or
  log their contents. Saved credentials are parsed again before recovery.
- The config file `/etc/macro/personas/<os_user>.env` holds the bootstrap
  credentials: `MACRO_API_KEY` (also `ANTHROPIC_AUTH_TOKEN`) and the repo-scoped
  `MACRO_REPO_TOKEN`. Write it with mode 600, owned by `os_user`. Every other
  secret goes through `agent_secrets`, fetched per use.
- Require the `agent-` prefix on every persona OS user, including stored enrollment
  input. Local preview agents created with old names must be re-invited; no legacy
  persona-name type or implicit OS-user migration is supported.
- Run `/opt/macro/brain run` as the name-derived OS user, with `MACRO_GATEWAY`,
  `BRAIN_WORKSPACE=/home/<os_user>/workspace`, `BRAIN_HEALTH_PORT=7801`,
  `MACRO_REPO_URL`, `MACRO_REPO_TOKEN`, `MACRO_AGENT_USER_ID`, `MACRO_API_KEY`,
  `ANTHROPIC_BASE_URL=<egress>/brain/anthropic`, and `ANTHROPIC_AUTH_TOKEN`
  in the persona config. The Anthropic token is that agent's own revocable API
  key, reused from `MACRO_API_KEY`.
- `outbound/hosted_runtimes_computers.rs` calls `ComputerService` in process;
  its purchase forwards the persona and seat in `extra_items` for one Stripe
  update. Tests keep the fake `Computers` port. The persona (name, job,
  personality) is written into the repo's `OPERATING.md` by `agent_git`.
- The computer adapter reads health through the harness domain repository using
  the saved computer's `harness_id`, matching team ownership, computer identity,
  and the enrolled persona OS user; it never reads another persona's report.
- Quote reports billing-provider outages as 502. Saved purchases retain their
  agent and bootstrap credentials through payment resolution. Provider details
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
Failed computers reuse the saved computer ID, persona bootstrap
credentials, and `team_agents.persona_seed`; recovery never buys another computer,
adds a seat, creates an account, or mints an API key. Repo recovery calls the git
service's `ensure` API, which preserves live tokens and repo contents. A missing
repo is reseeded, not restored from deleted history. Older rows with no saved seed
or computer return 409. Retry errors leave the agent available for another attempt.

The outbound adapter calls the shared `ComputerService::retry(team_id, computer_id)`
in process, maps `NotFailed` to 409 and other-team computers to 404, and returns the
fresh computer status and setup progress on the agent. Bootstrap credentials remain
in the existing computer persona; the seed column contains the original name,
job, personality and optional creator user ID. New seeds set `creator_id` from
the creating admin; older saved JSON defaults it to absent and retry recovers it
from the account's `created_by` before repo recovery.

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
