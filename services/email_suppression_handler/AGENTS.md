# email_suppression_handler

## What it is

An SNS-triggered Lambda that processes SES bounce and complaint notifications
and adds selected recipients to the global blocked-email list.

## Start here

- `src/handler.rs`: SNS iteration, JSON decoding, dispatch and per-record logs.
- `src/domain/`: notification models, suppression policy, storage port and tests.
- `src/outbound/postgres.rs`: calls the existing blocked-email database helper.
- `src/composition.rs`: wires the storage adapter into the domain service.

## Scope

- Owns: bounce and complaint suppression decisions.
- The existing `macro_db_client::blocked_email` helper owns lowercase conversion
  and the conflict-ignoring bulk insert. Keep its input order and duplicates.

## Checks

- `cargo nextest run -p email_suppression_handler --all-features -j 8`
  (`SQLX_OFFLINE` unset).

## Gotchas

- Preserve serde and Debug shapes, including unused notification metadata.
- A present complaint subtype, including an empty string, takes precedence over
  feedback. Empty recipient lists still call the storage helper.
- Record errors are logged and processing continues; the Lambda returns success.
- Four transient-bounce subtypes retain their existing panic behavior. Later
  records cannot run after that panic; the ordinary should-panic tests pin it.
- Existing raw-message and recipient telemetry is part of this refactor's behavior
  contract; do not change it while moving policy.
