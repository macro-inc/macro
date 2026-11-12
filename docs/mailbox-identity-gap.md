# Mailbox identity gap

The first-party mailbox address is `handle` at the first-party domain, and the account's Rox link
is created from the claimed handle. The mailbox itself is not provisioned: no
process in this repository asks the Rox mail host to create it. This file
records that gap so the next reader does not mistake the domain model for a
working mailbox.

## What exists

- `RoxMailboxProvisioner` in
  `services/email_service/src/outbound/rox_provisioning.rs` is a server-side
  adapter for the mail host's `POST /api/provision` contract. It sends a Bearer
  token, classifies failures as `Unauthorized`, `HandleTaken`, `Unavailable` or
  `InvalidResponse`, and keeps the returned one-time password in `Zeroizing`
  memory only. Its tests drive it against a loopback HTTP server; no test calls
  `mail.rox.one`.
- `ROX_MAIL_PROVISION_URL` names the production endpoint and `production()`
  builds the adapter for it.
- `ensure_rox_mailbox` in
  `services/email_service/src/outbound/mailbox_init.rs` creates the account's
  `provider = ROX` row in `email_links` from the claimed handle, as the single
  primary link for that `macro_id`. It is reached from `POST /email/init`
  without a `link_id` and involves no provider client.

## What is missing

- `RoxMailboxProvisioner` has no production caller. Nothing in the service
  composition or in any request path constructs it, and `production()` is
  unreferenced outside its own definition.
- No Rox broker token is wired. The service configuration carries
  `rox_mailbox_writes_enabled` and no broker credential, and `provision` cannot
  run without an `access_token` argument that no code supplies. No such token
  is invented here, and none is read from the repository.
- No mailbox is provisioned at the host. Creating the `ROX` link row does not
  create an account on `mail.rox.one`, so the address exists in the product's
  database only.
- `identity_gap` is the required stopping point. `prompts/02-mail-drive.md`
  requires shipping the domain model and the fake-backed adapter and reporting
  `identity_gap` when the workspace has no Rox broker token to send. The
  remaining work is the token source and the call site that provisions the
  mailbox before or alongside the local `ROX` link; both are out of scope until
  a token exists.
