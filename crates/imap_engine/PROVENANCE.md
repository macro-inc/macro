# Protocol engine provenance

The behavior port is based on EmailEngine 2.89.0, revision
`48f2fd0744ea0e35e7d39359aa3c547f90eca37a`, from
<https://github.com/postalsys/emailengine>. The corresponding source license is
preserved in [LICENSE_EMAILENGINE.txt](LICENSE_EMAILENGINE.txt). This notice does
not change the upstream license or relicense upstream-derived material.

The Rust implementation replaces EmailEngine's HTTP/admin product, Redis state,
process RPC and webhook delivery with Macro's authenticated Axum API, PostgreSQL
leases and journal, KMS credentials and existing email domain workers. IMAP wire
handling uses `async-imap`; SMTP submission uses the engine's bounded transport.

Behavior derived from the upstream modules includes:

- `lib/email-client/imap/adaptive-idle.js` and `adaptive-idle-store.js`:
  `src/domain/adaptive_idle.rs` and PostgreSQL host observations.
- `lib/bounce-detect.js`, `lib/arf-detect.js`, arrival triage and autoreply checks
  in `lib/email-client/base-client.js`: `src/domain/bounce/`.
- `lib/autodetect-imap-settings.js`: `catalog/providers.toml`,
  `src/domain/discovery.rs` and `src/outbound/discovery/`.
- Account/folder/message lifecycle, synchronization, stable identity, submission
  admission, Sent reconciliation and connection reuse: `src/domain/service/`
  and `src/outbound/protocol/`.

Macro-specific authorization, ownership, generation fencing, verified sender
checks and IP egress protection apply at their own domain boundaries. Tests use
synthetic accounts and local mail fixtures; no user mailbox data is included.
