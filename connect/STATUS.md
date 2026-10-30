# Status

Last updated 2026-10-30 by Claude (planning session). Slice 1: Connect as an
independent backend with integration tests. Target: Macro's own
users off Pipedream for catalog apps by 2026-11-06 ([plan](docs/plan.md#week-one)).

## Human queue

Eric. Each item is ready for one sitting; agents prepare the rest.

- [ ] **Review PR #9231** (Connect as an independent backend; touches none of
      Macro's deployed services).
- [ ] **First dev deploy** (after T016 and your review): Connect's own Pulumi
      project in `connect/infra`, stack `dev`. You provide Pulumi access
      (`PULUMI_ACCESS_TOKEN`) and approve `pulumi up` after seeing the preview.
      It creates Connect-only AWS resources plus one DNS record,
      `connect-dev.macro.com`.
- [ ] **Test workspaces** for the first slice (Linear, Notion, PostHog,
      Sentry): accounts an agent may sign in to, or the `connect@macro.com`
      browser sign-in below so agents create free ones.
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
- [ ] Sign in once in Macro Connect's browser: `ssh -L 6081:localhost:6081
      big-pickle`, open http://localhost:6081/vnc.html; the Google sign-in page
      for `connect@macro.com` is open. While signed in, enroll an
      authenticator-app (TOTP) second factor and save its setup key as
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

- [T016](tasks/T016-independent-hosting.md) independent hosting in `connect/infra`,
  local compose run, no Doppler at runtime: builder, branch
  `connect/T016-independent-hosting` (PR #9231).
- [T009](tasks/T009-connect-client.md) `connect_client`: built on the old base;
  to be reviewed and brought onto PR #9231.

## Next

T017 integration tests against the local stack and the dev deploy (after T016
and T009). Later slices: [T010](tasks/T010-macro-adapter.md) Macro integration,
then reconnect prompts (T011). Submissions wait on the company
facts above.

## Done

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
