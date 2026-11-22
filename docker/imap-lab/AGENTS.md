# IMAP protocol lab

Real Dovecot IMAP/submission, optional Stalwart interoperability, and Mailpit capture for the IMAP engine's tests.
All published ports bind loopback. Each username gets its own Dovecot mail home.

## Checks

- `bash docker/imap-lab/prepare.sh`
- `docker compose -p macro-imap-lab -f docker/imap-lab/compose.yaml config --quiet`
- Exercise implicit TLS and STARTTLS with the generated CA; never disable certificate verification.
- `IMAP_LAB_REQUIRED=true python3 -m unittest discover -s docker/imap-lab -p test_control.py`
  checks the oracle, including two real TLS clients moving a UID between SEARCH
  and FETCH. Start the owned Dovecot lab first.

## Gotchas

- Generated keys are local disposable test fixtures and stay ignored.
- Only stop the Compose project started for this task; other stacks are shared.
- Dovecot's rootless internal listeners use 31143, 31993, 31587 and 31465.
- The independent oracle confirms a missing UID with SEARCH and restarts its
  entire scan, bounded by one ten-second deadline. It never publishes a partial
  scan; the API scenario still requires the message exactly once in Archive.

## Second server

After preparing the CA, run `python3 docker/imap-lab/stalwart.py`. This starts
the optional pinned Stalwart profile and configures its local domain, TLS
certificate and two disposable mailboxes through its JMAP configuration API.
IMAPS is on loopback 36993, SMTPS on 36465, and the configuration API on 36880.
Use hostname `maillab.example.net` with the generated CA for TLS verification.
The test users `stalwart-alice@example.net` and `stalwart-bob@example.net` use
`lab-mail-pass`; these are synthetic local fixtures. No ACME or public DNS
changes are requested. Configuration and mail persist in task-owned volumes;
rerunning setup preserves them.

## Full API scenarios

`bash docker/imap-lab/start.sh` prepares trusted TLS, starts Dovecot, Mailpit
and the local KMS emulator, and provisions the disposable credential key alias.
The email E2E workflow calls it before the IMAP scenarios. For isolated local
queue infrastructure, start the `e2e` Compose profile: SQS uses loopback 37924
and Kafka advertises loopback 37992. Existing local Postgres and Redis can be
shared because the harness allocates a separate database and Redis lease.

## SMTP bytes and blind recipients

Dovecot records native relay transcripts under the ignored `generated/relay-rawlog`
bind mount. `control.py` reads them through Docker, removes the rawlog timestamp
prefixes and extracts SMTP DATA for an exact subject. Use this oracle to assert
Bcc absence: Mailpit 1.20.7 intentionally prepends a synthesized Bcc header for
envelope recipients absent from To/Cc before storing its displayed raw MIME.
Mailpit remains the delivery and envelope oracle. These transcripts contain only
disposable lab traffic and must never be enabled in deployed environments.
