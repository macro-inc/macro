# meta_messaging

Owns Meta authorization, provider account lifecycle, webhook ingestion and the
adapter behind native customer messaging. Domain policy lives in `src/domain`;
`src/inbound` adapts HTTP/webhooks; `src/outbound` implements provider, encrypted
credential and database ports. DSS wires the native channel and access adapters. Identity-only persistence belongs
to the messaging repository; domain services gate membership at each effect boundary.

## OAuth boundary

Instagram completion requires the independent browser proof returned at begin,
plus the initiating authenticated Macro team/user and current membership.
Reconnect, disconnect and import initiation require the current connector/member
or a current team admin. Recheck connector membership before new effects.
Repeated disconnects still verify manager authority, but return read-only status
without acquiring the provider subscription lock once locally disconnected.
Keep access tokens and registration PINs in zeroizing buffers with no Debug or Serialize.
Never add a public state-only completion path. WhatsApp uses Embedded Signup.
See `docs/META_MESSAGING.md` for redirect configuration and rollout gates.

## Identity and readiness

Use one connection-scoped BSUID alias table; keep phone and its timestamp on the
conversation. Remove legacy phone aliases on upgrade, never merge histories, and
drop ambiguous phone-only facts terminally. Never join by display names. Platform registration stays pending until
Meta confirms registration and subscription; preserve uncertain attempts and
encrypted credentials without persisting PINs. Never infer missing registration
from an arbitrary non-CONNECTED provider status. Accepted native recovery is separate
from new provider dispatch. Enqueue only reads/validates native attachments; dispatch
repeats that read and validation before preparing provider media. Never stage copies
during enqueue or its idempotent replays.
Production replies prefer BSUIDs. Developer test accounts may address the current
phone only when that exact phone is allowlisted for the configured test sender;
keep the dispatch identity/phone race checks and never infer historical phones.

## Checks

- `cargo test -p meta_messaging --all-features` with SQLX_OFFLINE unset and an
  isolated migrated local database.
- DSS HTTP fixtures in `native_messaging/native/test/http/oauth.rs` exercise the
  actual domain, repository and access checks with a controlled provider.
- Regenerate the storage OpenAPI contracts when authorization DTOs change.

## WhatsApp groups

`domain/meta/groups.rs` owns connector/native/team authorization and explicit create,
retry, discard and deletion decisions. Group adapters keep Meta payloads and
current-attempt storage separate; only signed matching request IDs bind groups.
Participant facts never create direct chats/windows. Group callbacks use short connection/setup row-locked transactions and bounded receipt
retry. User operations retain the subscription guard through native deletion; atomic
discard rejects a concurrently bound setup. Invite-link access and deletion require
explicit human authority. App-level group callback configuration is checked during each create/retry preflight and recovers without restart. Completed creation retains its original subject/generation so authorized retries cannot create twice.
See `docs/META_MESSAGING.md#whatsapp-groups` for the contract and scope.

## Personal WhatsApp linked devices

Personal linked devices use `domain/linked` and `outbound/linked`, independently of Meta business `Connection`. Shared sends select the authenticated actor through `account_for_sender`; never replace that selection with a binding owner/observer. Account authorization generations and process ownership epochs are separate. Recheck private-document access after transport preparation. See `docs/WHATSAPP_LINKED_DEVICES.md`.
