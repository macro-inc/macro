# queue_gateway

## What it is

The queue backend of a Macro instance on Kubernetes. It serves the SQS API and keeps
messages in Kafka, so services use `aws_sdk_sqs` unchanged and an instance runs one
messaging system. Production uses real SQS; this never runs there.

## How it works

Each queue is the topic `queue.<name>`, read by one consumer group. Unacknowledged
messages stay in memory with the state SQS would track, and an offset is committed
only once every message before it was deleted. A restart therefore redelivers what
was in flight, which is SQS's at-least-once contract.

## Start here

- `src/state.rs`: the queue semantics, without Kafka or HTTP.
- `src/api.rs`: the SQS JSON protocol.
- `src/kafka.rs`: topics, consumers, and queue metadata.

## Scope

- Owns: visibility timeouts, redelivery, dead-letter redrive, FIFO groups,
  deduplication, delay.
- Not here: anything service-specific. Services see an SQS endpoint.

## Boundaries

- One replica per instance: consumers own their in-flight state.
- Used by: every service through `localstack:4566` (`infra/platform/components.nix`).

## Checks

- `cargo test -p queue_gateway`

## Gotchas

- SQS clients carry no trace context to receivers. Each message keeps its sender's
  `traceparent`, logged as `upstream_traceparent` when delivered, so a flow is findable
  across the queue even though it is two traces.
- `ApproximateReceiveCount` resets on restart, because it lives in memory, so a poison
  message can get extra attempts before reaching its dead-letter queue.
- Request signatures are not verified: the gateway is reachable only inside its
  instance's namespace.
- `.fifo` ordering relies on one partition per queue topic, the broker default.
