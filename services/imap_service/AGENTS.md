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
- Pass the actual service shutdown token, tracker and derived VerificationScopeKey into Engine; refuse new
  unadmitted sends during shutdown without replacing a prior Unknown outcome.
  Track admitted Submit work with scheduler tasks, independently of HTTP cancellation.
  Give HTTP and tracked-work shutdown one shared thirty-second drain, below the
  120-second ECS stop timeout; warn with remaining task count on expiry, and
  flush telemetry before returning either result.
  Retain the existing thirty-second service drain: a longer send can be cut off
  during deployment, deliberately keeping Unknown for confirmation instead of
  automatic resend.
- Keep code-level `AccountCapacity::DEFAULT` at 150 owned actors and 25 new
  actors per thirty-second tick; retain existing owners when a cap is reached.
  Host watches use 150 of 200 connector sockets. Beyond that, primary and extra
  folders use a thirty-second SELECT poll, leaving 50 sockets for commands and
  verification. A new-mail arrival can take up to thirty seconds under saturation.

`SyncConcurrency::DEFAULT` is the typed code-level limit of 2. Tune it in a
reviewed code change only after measuring round duration and memory; no new
Doppler configuration is required. It limits active
rounds, not IDLE actors or mailbox coverage. Queue depth/wait and saturation are
visible in `imap.admission`; H3 paging is required to shrink long initial rounds.

Derive the verification subkey from the required INTERNAL_AUTH_KEY once at
startup; do not retain another copy of the bearer key in Engine or add a new
configuration secret. Rotation starts fresh owner and login verification buckets
without resetting host quotas.

Keep the engine pool lazy with minimum zero and maximum ten connections. Derive
its idle timeout as one third of the thirty-second scheduler poll, so an empty replica
releases its poll connection between rounds. Start LISTEN only after the first
non-empty bindings result, then retain it until shutdown; the scheduler poll
admits the first enrollment independently of notifications. The listener counts
within the ten-connection limit.
