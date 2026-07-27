# soup_realtime

Hexagonal components for turning existing document, project, chat, email, and channel Kafka events into recipient-targeted Soup patches.

The inbound consumer maps each source event to `Patch::Updated(Entity)` or `Patch::Deleted(Entity)`. The domain service expands current access and publishes one patch per recipient to `macro.soup`; it does not hydrate or serialize `SoupItem` values. Channel threads use their containing channel as the access source.

The Soup topic carries `Patch<(MacroUserIdStr<'static>, Entity<'static>)>` and is also keyed by recipient user ID. Delivery is at least once: offsets are committed only after successful fan-out, and exhausted retries stop the consumer so its supervisor can restart it for redelivery. Downstream consumers must tolerate duplicate patches.

`SoupRealtimeConsumerService` consumes recipient-targeted patches and distributes `Patch<Entity<'static>>` values through instance-local, user-keyed subscriptions.
