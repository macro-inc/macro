# soup_realtime

Hexagonal components for expanding `document.updated` Kafka events into one full `SoupItem<()>` message per current accessor. The item is loaded once through the first accessor and its user-specific `viewed_at` field is set to `None` before fan-out.

This crate intentionally does not start a consumer or wire itself into a service binary. A later composition root can combine the domain service with the entity-access, Soup repository, Kafka publisher, and Kafka consumer adapters exposed here.

Delivery is at least once. If publication partially succeeds and processing is retried, downstream consumers may receive duplicate messages.

`SoupRealtimeConsumerService` can run a realtime consumer adapter and distribute received items through instance-local, user-keyed subscriptions. Subscription values are shared as `Arc<SoupItem<()>>` so multiple subscribers do not require cloning the underlying item.
