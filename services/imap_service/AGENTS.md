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
- Give HTTP and tracked work one shared shutdown drain. Keep admitted SMTP
  submissions on the tracker after their request ends, and preserve a durable
  Unknown outcome if shutdown cuts off the final reply.
- Derive the verification subkey at startup. Keep the engine pool lazy and
  count LISTEN within its connection limit.
- See the [engine architecture](../../docs/architecture/imap-engine.md) for
  shutdown, admission, scheduler capacity, and database pool budgets.
