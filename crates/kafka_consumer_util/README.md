# kafka_consumer_util

Shared environment-aware Kafka consumer transport for backend inbound adapters.

The crate centralizes plaintext-local versus MSK-IAM construction, subscription, receive, pause, and commit dispatch. Application adapters remain responsible for decoding, retries, poison-message handling, and deciding when offsets are safe to commit.
