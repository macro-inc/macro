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

- Keep all three IMAP gates explicit and false by default.
- Reject IMAP test endpoint/trust-root overrides outside Environment::Local.
- The service requires a dedicated KMS key and internal key. It has no public
  gateway route and cannot decrypt credentials owned by another link or user.
- Stop and drain tracked scheduler work on shutdown.
