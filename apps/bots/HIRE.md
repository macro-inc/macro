# Hire checkout

The local fixture previews a signed-in owner, team-scoped offers and an accepted hire in setup. It uses synthetic offers injected into the checkout controller. The default app cannot submit a purchase. The production build excludes the Hire fixture.

Identity must come from the authenticated PR 7 session seam. The existing generated auth methods `getUserInfo` and `getTeam` return caller identity and current team membership. HTTP 204 for the team is a known signed-in account without a team. An owner or admin needs both teammate and computer rollout. The production identity or eligibility state stays unavailable when the adapter cannot establish it.

The admin `listTeamComputerPurchaseOffers` contract supplies resources, money in minor units, currency, billing cadence, due today and capacity. A price ID is not an offer ID or a price lock. A 422 can describe missing subscription terms or an interval the service cannot sell. A null card does not prove anything by itself. Check refreshed terms before confirmation. A successful invite acknowledges the teammate and its computer. The provisioning status remains independent.

Fleet selects the accepted teammate only when its requested team and agent match
the receipt created by this tab's mock checkout. The Brain link uses the receipt's
team and agent IDs. Brain resolves the same fixture receipt and shows Setting up.
A fresh tab or reload has no Hire receipt, and an unmatched deep link is unavailable.

## Backend follow-on

Add an authorized Hire-specific offer and confirmation contract. The offer should carry an opaque, expiring ID bound server-side to the authenticated account, exact team, size and quoted terms. Confirmation should require expected team and offer ID, verify membership, role, rollout, pricing and capacity under the authoritative transaction, then use the existing teammate provisioning service. Deny a changed or expired offer before creating an account, seat or charge. Return a typed refusal or pending/confirmed receipt keyed by the existing purchase intent. Exact money rules, including permissible proration drift, need a product decision.

Bind the idempotency record to the authenticated actor and immutable request fingerprint. Expose a scoped read to reconcile by key after uncertain sends. Store a real attempt's key and body across navigation and restarts. The local controller only holds its fixture attempt in memory. Until the expected-team and offer checks exist, the client must not call the unbound `POST /team_agents`. This endpoint derives the team anew on each request, and an existing record is deduplicated by team and key without comparing the profile payload. The standalone computer purchase endpoint is separate.

- Generated reads and invite in `packages/sdk/generated/auth/sdk.gen.ts:766,844,852,1104,1112,1266`.
- Team resolution in `crates/entity_access/src/inbound/axum_extractors/team.rs:59–90,247–257`.
- Invite authority and side effects in `crates/team_agents/src/inbound/axum_router.rs:182–223` and `crates/team_agents/src/domain/service.rs:413–424,481–535`.
- Team/key dedupe in `crates/team_agents/src/outbound/pg_team_agents_repo.rs:290–328`.

## Disposable signed review

`bun run --filter @macro-inc/bots dev:hire` starts an ephemeral loopback
listener for the isolated review. Set `BOTS_HIRE_REVIEW_AUTH` to the
dedicated issuer on port 23211 and `BOTS_HIRE_REVIEW_TEAM` to its seeded
team UUID. Set `BOTS_HIRE_REVIEW_BINARY` to the absolute path of the Rust
review example, and `BOTS_HIRE_REVIEW_SOCKET` and
`BOTS_HIRE_REVIEW_DB_ROLE` to the same disposable database.

The app checks the signed reviewer and current team before sending a
command to the helper in a network namespace. The helper offers only
zero-charge local compute. Fleet and Brain read the persisted roster using
the same team scope and opaque computer UUID. Booting reflects the local
process exercising the lifecycle. The product and signed read-only builds
keep their usual gates.
