# Hire checkout

The local fixture uses a sample account and team. Choose **Hire**, continue with
the sample account, and review the draft and computer offers. Confirming creates
a same-tab sample receipt. The default build excludes sample checkout and
leaves service purchases disabled.

The opaque return URL carries a one-use handoff ID. The same tab restores the
full draft for up to ten minutes, including the preset, appearance, names, tab,
and operating choices. The artist preview angle is temporary. Sample
Intelligence, Autonomy, and hourly estimates illustrate the profile.
Computer size maps to the generated request type and the review uses the
adapter's verified offers. Responsibilities and Personality map to the
corresponding prose fields. Review captures the configured portrait in its
front-facing pose. It uses the current Three.js scene when available and the
same SVG portrait as Creator when WebGL2 or the scan cannot load. The fixture
keeps the exact review image and operating choices in its receipt.

Identity must come from the authenticated PR 7 session seam. The existing generated auth methods `getUserInfo` and `getTeam` return caller identity and current team membership. HTTP 204 for the team is a known signed-in account without a team. An owner or admin needs both teammate and computer rollout. The production identity or eligibility state stays unavailable when the adapter cannot establish it.

The admin `listTeamComputerPurchaseOffers` contract supplies resources, money in minor units, currency, billing cadence, due today and capacity. A price ID is not an offer ID or a price lock. A 422 can describe missing subscription terms or an interval the service cannot sell. A null card does not prove anything by itself. Check refreshed terms before confirmation. A successful invite acknowledges the teammate and its computer. The provisioning status remains independent.

Fleet selects the accepted teammate only when its requested team and agent match
the receipt created by this tab's mock checkout. The Brain link uses the receipt's
team and agent IDs. Brain resolves the same fixture receipt and shows Setting up.
The receipt keeps the confirmed portrait and exact selection. A fresh tab or
reload has no Hire receipt, and an unmatched deep link is unavailable.

## Backend follow-on

Add an authorized Hire-specific offer and confirmation contract. The offer should carry an opaque, expiring ID bound server-side to the authenticated account, exact team, size and quoted terms. Confirmation should require expected team and offer ID, verify membership, role, rollout, pricing and capacity under the authoritative transaction, then use the existing teammate provisioning service. Deny a changed or expired offer before creating an account, seat or charge. Return a typed refusal or pending/confirmed receipt keyed by the existing purchase intent. Exact money rules, including permissible proration drift, need a product decision.

Bind the idempotency record to the authenticated actor and immutable request fingerprint. Expose a scoped read to reconcile by key after uncertain sends. Store a real attempt's key and body across navigation and restarts. The local controller only holds its fixture attempt in memory. Until the expected-team and offer checks exist, the client must not call the unbound `POST /team_agents`. This endpoint derives the team anew on each request, and an existing record is deduplicated by team and key without comparing the profile payload. The standalone computer purchase endpoint is separate.

- Generated reads and invite in `packages/sdk/generated/auth/sdk.gen.ts:766,844,852,1104,1112,1266`.
- Team resolution in `crates/entity_access/src/inbound/axum_extractors/team.rs:59–90,247–257`.
- Invite authority and side effects in `crates/team_agents/src/inbound/axum_router.rs:182–223` and `crates/team_agents/src/domain/service.rs:413–424,481–535`.
- Team/key dedupe in `crates/team_agents/src/outbound/pg_team_agents_repo.rs:290–328`.
