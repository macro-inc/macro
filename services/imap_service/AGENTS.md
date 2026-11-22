# imap_service

## What it is

Private HTTP composition root for the IMAP/SMTP engine. Owns configuration,
Postgres/KMS/transport wiring, the synchronization scheduler, health and graceful
shutdown. User-facing routes live in email_service.

## Checks

- `cargo test -p imap_service`.
- `cargo run -p imap_service --bin imap_service_openapi`.
- Exercise verification, connection, reads, writes and submission against the
  real Dovecot/SMTP lab in `docker/imap-lab`.

## Gotchas

- Keep rollout admission at the user-scoped email enrollment boundary;
  established sync and writes run without PostHog polling.
- Reject IMAP test endpoint/trust-root overrides outside Environment::Local.
- The service requires a dedicated KMS key and internal key. It has no public
  gateway route and cannot decrypt credentials owned by another link or user.
- Stop and drain tracked scheduler work on shutdown.

`SyncConcurrency::DEFAULT` is the typed code-level limit of 2. Tune it in a
reviewed code change only after measuring round duration and memory; no new
Doppler configuration is required. It limits active
rounds, not IDLE actors or mailbox coverage. Queue depth/wait and saturation are
visible in `imap.admission`; H3 paging is required to shrink long initial rounds.
