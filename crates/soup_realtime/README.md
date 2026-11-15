# soup_realtime

Hexagonal components for turning existing document, project, chat, email, channel, property, and imported-call Kafka events into recipient-targeted Soup patches.

The inbound consumer maps each source event to `Patch::Updated(Entity)` or `Patch::Deleted(Entity)`. Entity-property updates, deletions, and clears map to updated Soup entities; property task entities map to their document representation. Property definition and option lifecycle events are ignored because they do not identify every affected entity. The domain service resolves the current accessors of a batch of patches in one access lookup and publishes one patch per recipient to `macro.soup`; it does not hydrate or serialize `SoupItem` values. Channel threads use their containing channel as the access source.

The Soup topic carries `Patch<(MacroUserIdStr<'static>, Entity<'static>)>` and is also keyed by recipient user ID. The consumer publishes an event's patches in batches of up to 500, each resolved with one entity-access lookup per entity type and retried as a unit, so a large folder event makes a bounded number of lookups. A source event's offset is committed once every batch is published, or once a batch exhausts its five attempts, when the rest of that event is logged and dropped so it cannot wedge its partition. Shutdown mid-event leaves the event uncommitted for redelivery, so downstream consumers must tolerate duplicate patches. The Soup-topic receiver returns after five failed receives so its supervisor can restart it.

`SoupRealtimeConsumerService` consumes recipient-targeted patches and distributes `Patch<Entity<'static>>` values through instance-local, user-keyed subscriptions.
