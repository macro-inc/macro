# soup_realtime

Hexagonal components for expanding `document.updated` Kafka events into one full, user-scoped `SoupItem<()>` message per current accessor.

This crate intentionally does not start a consumer or wire itself into a service binary. A later composition root can combine the domain service with the entity-access, Soup repository, Kafka publisher, and Kafka consumer adapters exposed here.

Delivery is at least once. If publication partially succeeds and processing is retried, downstream consumers may receive duplicate messages.
