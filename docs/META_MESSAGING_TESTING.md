# Messaging verification

Configuration, permissions, supported behavior and rollout requirements live in
[META_MESSAGING.md](META_MESSAGING.md). Automated fixtures use isolated PostgreSQL,
HTTP doubles and a bundled browser app; they do not establish live provider delivery.

## Automated checks

Use the repository Nix shell and a fresh disposable database per the
[database guide](development/database.md). Never reset a shared/demo database.

```sh
: "${DATABASE_URL:?Set DATABASE_URL to an isolated test database}"
sqlx database create
sqlx migrate run --source crates/macro_db_client/migrations
unset SQLX_OFFLINE
cargo test -p meta_messaging --all-features
cargo test -p channels --all-features
cargo test -p document_storage_service --lib native_messaging
```

Run affected document/access/team tests when those boundaries change. Run `just check`,
applicable Clippy/type/frontend tests and cargo-deny. Regenerate production-only SQLx
metadata via `just prepare_db` (never `--tests`), plus OpenAPI/generated clients when
contracts change. A command that did not execute is not a passing check.

Coverage responsibilities:

- Domain/database: permission and reconnect fences, account/WABA serialization and pool
  headroom, ordering, ambiguous sends, accepted-only native recovery, identity scoping,
  history consent/checkpoints and attachment reservations.
- DSS HTTP/database: signed callbacks, OAuth browser proof and management roles, registration,
  private channels/files, group create/retry after binding, deletion and native mutation guards.
- Provider HTTP: request-ID correlation, missing/transient subscriptions and recovery, BSUID
  payloads, limits and positive deletion confirmation versus HTTP 200 ambiguity/404/131041.
- Browser: real routing/composer/query/socket integration, drafts, metadata failure/retry,
  zero Meta requests for native channels, Settings PIN retention and desktop/mobile group controls.

## Browser journeys

Build once in `apps/web` with local fixture routing:

```sh
VITE_LOCAL_SERVERS=ALL VITE_LOCAL_BACKEND_ORIGIN=same-origin \
VITE_ENABLE_GRAPHQL_SOUP=true VITE_DISABLE_BROWSER_TURSO_CACHE=true \
VITE_ENABLE_IN_APP_TOURS=false VITE_ENABLE_BROWSER_OTEL=false just build-dev
FUNCTIONAL_MESSAGING=1 bun run test:functional meta-messaging.spec.ts
```

The shared runner defaults to lightweight Vite fixtures. `FUNCTIONAL_MESSAGING=1` adds the
bundled messaging tests and preview server; CI runs them in Messaging Browser Check when
messaging/shared channel/composer/permission paths or dependencies change. Set
`FUNCTIONAL_TEST_PORT` (default 4191), `FUNCTIONAL_APP_PORT` (default next port) or
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when needed.

`fixtures/meta-messaging.ts` owns synthetic transport and blocks nonlocal traffic. Independent
journeys cover native channels, external composition/recovery, account registration/mobile
composition, and group creation/desktop/mobile management. Keep browser integration and real
HTTP/database coverage: neither substitutes for the other. Screenshots and traces belong in
Playwright’s per-test output directory; no recording or real account activity is required.

## Controlled live verification

Live messages, account changes, registration, group mutations and deployments require explicit
authorization. Use only controlled recipients/accounts and the final deployed revision.
Preserve existing applications, callbacks, local stacks and data. Store secrets privately.

Prepare Meta’s WhatsApp API Setup test number and verified recipient allowlist, or an eligible
coexistence/Platform number for flows the test number cannot prove. Instagram needs a controlled
Business/Creator account, tester invitation acceptance, messaging access and a second customer
account. Use Instagram Login, not older Page-token/Facebook Login instructions.

Configure the [server variables and callbacks](META_MESSAGING.md#server-configuration), KMS,
account subscriptions and required app publication/review. Webhook verification and synthetic
notifications alone do not prove real delivery. Expose only webhook paths over public HTTPS;
Instagram login returns to the same web origin as Settings. Media URLs must be provider-reachable.

1. Connect via Settings → Integrations → Accounts. Use the local **Connect test number** action
   only for the allowlisted developer account. Other WhatsApp accounts use Embedded Signup v4.
2. Send a fresh customer message from each controlled provider account. Confirm the private native
   channel, External author label, account identity and single reply composer.
3. Submit a human reply and verify it in the original app. A provider acceptance ID is not a
   delivery receipt. Verify failed/unknown recovery is deliberate and never automatically resends.
4. Test supported media, signed URL expiration, invited-teammate access and uninvited-user denial.
5. Verify disconnect/reconnect, token expiry, connector departure, worker restart and newer
   generation fencing. Existing channel/file ownership must remain unchanged.
6. Exercise explicit history import separately: no consent means no backfill; imported content
   keeps original authors/times, private permissions and manual names, deduplicates live overlap,
   and does not open reply windows. Reconnect invalidates old consent.

Coexistence history needs phone consent, history/sync subscriptions and initiation within
24 hours; keep the phone app open. Test numbers cannot qualify coexistence or groups. Instagram
history needs Conversations API access independently of OAuth. For registration, prove encrypted
credential retention after rejection and reconciliation of uncertainty; never register/migrate a
new number without authorization. Eligible groups require OBA/Platform qualification and every
required callback. Prove creation, invite/link permissions, participant facts, reply windows,
suspension, confirmed deletion and lost-response retries without adopting arbitrary groups.

## Instagram login isolation

Verify the same-origin callback and backend together. Test begin/complete with the correct
browser proof; reject missing/wrong proof, another user/team, expired/replayed state, revoked
membership and the wrong reconnect identity before exchanging credentials. Test cancellation,
closed popup, page reload and mobile web without leaking codes or losing unrelated Settings UI.
The former public DSS completion route must return 404. Verify no-store/no-referrer, no query
logging and popup-compatible headers on the deployed origin; local tests cannot validate CDN policy.

## Troubleshooting

- Accepted but undelivered: inspect the status webhook and original app; do not resend blindly.
- WhatsApp 131030 or missing test number: verify app/WABA, token, sender and recipient allowlist.
- Real Instagram DMs missing: verify tester roles, permissions, account subscriptions, requests
  and app publication. OAuth success does not prove Conversations API or webhook access.
- Group preflight fails: repair subscriptions/eligibility and retry; no service restart is needed.
- Callback hostname or server variables changed: update the exact local configuration and recreate
  affected services while preserving unrelated endpoints. Never expose the entire local stack.
