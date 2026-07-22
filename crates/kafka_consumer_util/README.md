# kafka_consumer_util

Shared environment-aware Kafka consumer transport for backend inbound adapters.

The crate centralizes plaintext-local versus MSK-IAM construction and exposes two type-safe consumption modes:

- Named consumer groups implement `GroupName` and may subscribe, pause, receive, and commit.
- `Ungrouped` consumers use manual partition assignment and may pause and receive, but cannot subscribe or commit.

Ungrouped consumers assign every current partition at an explicit earliest or latest offset. Application adapters remain responsible for decoding, retries, poison-message handling, and refreshing assignments if topic partition counts change.
