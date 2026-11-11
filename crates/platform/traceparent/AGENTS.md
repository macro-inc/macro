# traceparent

## What it is

Observability plumbing: `current()` reads the current span's W3C
`traceparent` as one string, and `adopt()` parents a span on a stored one.
For hops that carry a single value rather than headers: Postgres rows and
`NOTIFY` payloads (`email`, `external_chat`), SQS message attributes
(`sqs_client`).

## Boundaries

- Depends on: `opentelemetry`, `tracing-opentelemetry`.
- Used by: `email`, `external_chat`, `sqs_client`, and the services that
  read what they store (`email_service`, `document_storage_service`,
  `whatsapp_session_service`).

## Checks

- `cargo test -p traceparent`

## Related

- Rules: `.agents/rules/observability.md` · Header and Kafka propagation:
  `macro_tower_layers`, `kafka_util`; ACP `_meta`: `genai_telemetry::propagation`
