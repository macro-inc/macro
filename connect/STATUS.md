# Status

Last updated 2026-10-31 by Claude. Slice 1 is deployed and proven end to end
on dev: `https://connect-dev.macro.com`, demo at
`https://connect-dev.macro.com/demo`. Target: Macro's own users off Pipedream
for catalog apps by 2026-11-06 ([plan](docs/plan.md#week-one)).

## Human queue

Eric. Each item is ready for one sitting; agents prepare the rest.

- [ ] **Review PR #9231** (Connect as an independent backend; touches none of
      Macro's deployed services).
- [ ] **Review the demo PR** (stacked on #9231): the demo app, its optional
      infra, and the CDP driver.
- [ ] **Company facts every vendor form asks for** (unblocks Zoom, Xero,
      Figma, Vercel, Box, Discord): legal company name; contact name, title,
      and email; Connect's production host and OAuth callback (proposed:
      `https://connect.macro.com`, callback `/v1/oauth/callback`); landing,
      privacy, terms, and support URLs (proposed: that host's `/`, `/privacy`,
      `/terms`, `/support`; agents draft the pages for your approval); a logo
      and wordmark. Approve the product description in each record's Draft.
- [ ] Xero: approve the Core plan (AUD$35/month, card on file) and choose
      read-only or read-write for v1.
- [ ] Box: approve sending the drafted email to `integrate@box.com`
      ([record](submissions/box.md)).
- [ ] Zoom: say which security evidence exists (SSDLC, SAST, DAST, pen test,
      security and incident policies); Zoom's review asks for it.
- [ ] Rotate the `connect@macro.com` password (it was shared in a chat
      transcript on 2026-10-30), then update `CONNECT_ACCOUNT_PASSWORD` in
      Doppler `connect/prd`.
- [ ] Enroll an authenticator-app (TOTP) second factor on `connect@macro.com`
      (the browser is signed in; view it with `ssh -L 6081:localhost:6081
      big-pickle` and http://localhost:6081/vnc.html) and save its setup key as
      `CONNECT_ACCOUNT_TOTP_SECRET` in Doppler `connect/prd`, so agents can
      sign in again without you. ([how it works](docs/submissions.md#browser))
- [ ] Give the submission agents read access to the `connect@macro.com` inbox
      (an IMAP app password or API token in Doppler `connect/prd`).
- [ ] GitHub and Slack (v1 reuses Macro's apps): approve copying their client ID
      and secret from Macro's Doppler into `connect-api` (once T012 adds it) as `GITHUB_CLIENT_*` and
      `SLACK_CLIENT_*` (an agent pipes them without printing), and add
      Connect's callback (`<host>/v1/oauth/callback`) to each app's allowed
      redirect URLs. Needed by T006.
- [ ] HubSpot, Asana: confirm whether Macro already has OAuth apps for their
      MCP servers (Macro users connect them today).
- [ ] Approve the Macro Connect landing, privacy, and terms pages once drafted
      (vendors require them).

## In flight

Nothing.

## Next

Token refresh against a live vendor (when a Linear or Sentry access token
expires, the gateway must refresh it; unit-tested, not yet seen live). Then
[T010](tasks/T010-macro-adapter.md) Macro integration and reconnect prompts
(T011). Submissions wait on the company facts above.

## Done

- 2026-10-31: Dev deployed (`pulumi up`, stack `macro-inc/macro-connect/dev`).
  `integration.sh dev` passes 11/11, including each vendor accepting Connect's
  client. Real consents completed for Linear, Notion, PostHog, and Sentry in
  [test workspaces](docs/test-accounts.md); through the gateway each listed
  its tools (70, 68, 1, 12) and answered a read tool call.
  [T019](tasks/T019-demo-app.md) demo deployed at `/demo`: connect, list
  tools, and call a tool from the browser. `cdp.ts` drives the browser.

- 2026-10-30: [T014](tasks/T014-deny-wrappers.md), [T015](tasks/T015-test-databases.md)
  CI fixes; [T016](tasks/T016-independent-hosting.md) Connect hosted
  independently in `connect/infra` with a local Compose run;
  [T017](tasks/T017-integration-tests.md) `connect_client` and integration tests
  (all 11 scenarios pass locally, including each live app's real authorize
  redirect). PR #9231 touches none of Macro's deployed services.
- 2026-10-30: [T013](tasks/T013-dev-slice-infra.md) Connect's own RDS (PostgreSQL
  17), Pulumi-written Doppler values through a project-scoped token, one-pass
  bootstrap ([runbook](docs/runbooks/bootstrap.md)); live catalog is Linear,
  Notion, PostHog, Sentry. Reviewed and merged.
- 2026-10-30: [T008](tasks/T008-mcp-gateway.md) streaming MCP gateway with
  refresh-and-retry and a header allowlist (customer keys never reach vendors);
  reviewed and merged. Not yet run against a live vendor.
- 2026-10-30: [T012](tasks/T012-deploy-stack.md) deploy inventory, `connect-api`
  Pulumi stack with grant KMS key, service URL, local stack (`/connect` through
  the local proxy); reviewed and merged.
- 2026-10-30: [T006](tasks/T006-oauth-flow.md) OAuth connect flow (CIMD, DCR, own
  app), single-use state, refresh; reviewed and merged. Not yet run against a
  live vendor: needs a public HTTPS URL (dev deploy).
- 2026-10-30: [T005](tasks/T005-connections-store.md) Connect database, hashed
  customer keys, KMS envelope-encrypted grants, connections API; reviewed and
  merged.
- 2026-10-30: [T007](tasks/T007-ci-covers-connect.md) CI runs Rust, ast-grep, and
  cargo-deny checks on `connect/` changes; reviewed and merged.
- 2026-10-30: [T003](tasks/T003-connect-api-skeleton.md) `connect_api` serves
  the catalog on `connect_platform`; [T004](tasks/T004-press-kit-icons.md)
  five press-kit icons (Apollo, Klaviyo, monday.com, Pipedrive publish no
  SVG). Reviewed and merged. `just check` now covers `connect/`.
- 2026-10-30: [T002](tasks/T002-registry.md) 36 day-1 apps in
  `registry/apps/` and the `connect_registry` crate; reviewed and merged.
- 2026-10-30: [T001](tasks/T001-cargo-boundary.md) Cargo boundary check in
  `cargo x deps --check`; reviewed and merged.
- 2026-10-30: Six vendor submissions drafted (Zoom, Xero, Figma, Vercel, Box,
  Discord); blocked on the company facts in the human queue.
- 2026-10-30: Measured Macro's MCP usage (4,057 Pipedream connections, 1,546
  native) and probed about 80 vendors' OAuth; results in
  [`docs/research/`](docs/research/).
- 2026-10-30: Plan, decisions, catalog spec, probing and submission
  procedures, skills.
- 2026-10-30: Doppler project `connect` created (configs `dev`, `prd`, `lcl`,
  `lcl_personal`); `CONNECT_ACCOUNT_EMAIL` and `CONNECT_ACCOUNT_PASSWORD` set in
  `prd`.
