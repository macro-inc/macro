# kafka_util

Shared environment-aware Kafka producer and consumer transports for backend adapters.

The crate centralizes plaintext-local versus MSK-IAM construction, provides a delivery-confirmed event producer, and exposes two type-safe consumption modes:

- Named consumer groups implement `GroupName` and may subscribe, pause, receive, and commit.
- `Ungrouped` consumers use manual partition assignment and may pause and receive, but cannot subscribe or commit.

Ungrouped consumers assign every current partition at an explicit earliest or latest offset. Application adapters remain responsible for domain mapping, decoding, retries, poison-message handling, and refreshing assignments if topic partition counts change.
