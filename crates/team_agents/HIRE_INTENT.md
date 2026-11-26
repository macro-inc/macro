# Hire intent protocol proof

Baseline is Macro `4485cabc70b18f97a1e1be749ce8a6229a3b32cb`. The
`src/domain/service/hire_intent.rs` module compiles only in Team Agents tests.
It reuses the invite validator, typed admin receipt, purchase key, compute
offer and purchase result. The proof uses in-memory fakes for authority,
commerce and the journal. It has no mounted handler, SQL, migration, account
provisioning, provider or product integration.

The protocol requires a positive current human-admin decision with rollout
from the authority, then compares the authenticated actor and expected
current team before touching an offer or receipt. A server-generated offer
binds scope, size, terms and expiry. In the proof a caller cannot specify
the lifetime. A single store operation inserts a pending receipt and
consumes the offer before dispatch. Matching retries read the same receipt,
even after expiry. Different profile data, another offer or another key
cannot repurpose a claimed intent. The downstream operation key derives
from the receipt and is separate from the legacy client key. This is a proof
identifier, so production still needs a protected namespace.

The journal distinguishes pending, unknown, charge confirming, purchase
confirmed and definitively refused with no charge. A journal-write failure
after dispatch returns an unconfirmed receipt ID. Lookup reads the existing
receipt. Reconciliation accepts evidence from the trusted commerce port for
the same receipt. Missing evidence does not advance or redispatch.
Previously linked computer identity cannot change on later observation.
A confirmed purchase says nothing about agent readiness, setup completion
or delivery. The proof does not read or synthesize `TeamAgentStatus`.

## Existing owners and compatibility

- Keep legacy `POST /team_agents` and its response unchanged. In
  `src/inbound/axum_router.rs:182–223`, the route requires account-holder
  authorization and an admin receipt and rejects program callers. In
  `src/domain/service.rs:413–424,481–535`, the legacy invite can return a
  teammate while its computer purchase is confirming. Existing replay
  finds the row by team and purchase key in
  `src/outbound/pg_team_agents_repo.rs:290–328`.
- A future guarded entry can reuse the existing invite orchestration and
  its undo. Keep membership with `teams`, provisioning with `team_agents`,
  and capacity, billing and settlement with `hosted_runtimes`.
  `src/outbound/hosted_runtimes_computers.rs:136–154` currently maps the
  linked purchase to an ID. The new path needs the typed `Purchase`
  outcome and authoritative status lookup. Existing reservation and
  reconciliation belong to
  `../hosted_runtimes/src/domain/service/purchase.rs:55–78,123–169,213–301`
  and `../hosted_runtimes/src/domain/service/billing.rs:560–594`.
- The admin offer preview and actual charge are separated today.
  `../hosted_runtimes/src/domain/service.rs:376–431` builds purchase offers.
  `../../services/authentication_service/src/outbound/computer_billing.rs:97–151`
  previews due today, and lines 176–231 resolve the purchase price and
  charge later. `../teams/src/domain/team_service/subscription_items.rs:116–136`
  owns the team billing serialization. Issuing a quote does not authorize
  an actual amount, reserve capacity or charge anything.

## Open before implementation

- Define the issuer and TTL, quote version, actual size/resource constraints,
  acceptable proration, credits/tax/discount and currency drift, team plan
  and comp policy, quote revalidation at the owning commerce boundary,
  and which check must be repeated by a delayed settlement worker. A
  quote preview, including due today, is insufficient evidence of a price
  lock, a reserved capacity slot or a combined seat/compute charge.
- Establish how current scope is resolved for issue, confirmation and read,
  whether to bind session identity as well as actor, and how revocation
  fences work after admission. The fake only proves per-entry authority
  and explicit current-team mismatch. It does not model mid-dispatch
  permission changes, provider/config drift, or concurrent subscription
  changes.
- Choose durable storage and actor-versus-team-admin visibility, retention,
  erasure/redaction and support escalation. Use the database clock and a
  real concurrency test before activating the atomic claim. Store no
  provider secrets, payment details, unnecessary profile text or raw
  identifiers in logs. The proof intentionally stores synthetic profiles
  in memory to compare normalized requests. Production needs a canonical
  fingerprint and an erasure strategy that preserves the dedupe fence.
- Define durable receipt recovery across process death, compensation,
  provider ambiguity and finalization after an acknowledgement loss. A
  missing agent/computer row does not prove that no charge occurred.
  Keep the intent receipt even if the invite is undone or its status
  changes. Confirmed purchase and later boot/refund remain distinct.
