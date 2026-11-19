# IMAP protocol lab

Real Dovecot IMAP/submission and Mailpit capture for the IMAP engine's tests.
All published ports bind loopback. Each username gets its own Dovecot mail home.

## Checks

- `bash docker/imap-lab/prepare.sh`
- `docker compose -p macro-imap-lab -f docker/imap-lab/compose.yaml config --quiet`
- Exercise implicit TLS and STARTTLS with the generated CA; never disable certificate verification.

## Gotchas

- Generated keys are local disposable test fixtures and stay ignored.
- Only stop the Compose project started for this task; other stacks are shared.
- Dovecot's rootless internal listeners use 31143, 31993, 31587 and 31465.
