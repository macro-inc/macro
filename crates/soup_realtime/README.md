# soup_realtime

Hexagonal components for turning existing document, project, chat, email, and channel Kafka events into recipient-targeted `SoupItem<()>` messages.

The inbound consumer maps each event to the Soup items it changes. The domain service expands current access, hydrates each item through every recipient's own visibility scope, and publishes the complete user-scoped values to `macro.soup`. Channel threads use their containing channel as the access source.

`document_storage_service` wires the consumer to the existing Soup domain service, entity-access service, and Kafka publisher. Delivery is at least once: offsets are committed only after successful fan-out, and exhausted retries stop the consumer so its supervisor can restart it for redelivery. Downstream consumers must tolerate duplicate messages.

Events for values that can no longer be hydrated, such as deletions and moves out of a visible collection, are currently ignored because the realtime topic carries complete updated items rather than tombstones.

`SoupRealtimeConsumerService` consumes recipient-targeted Soup messages and distributes them through instance-local, user-keyed subscriptions. Subscription values are shared as `Arc<SoupItem<()>>` so multiple subscribers do not require cloning the underlying item.
