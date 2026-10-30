# soup_realtime

Hexagonal components for turning existing document, project, chat, email, channel, property, and imported-call Kafka events into recipient-targeted Soup patches.

The inbound consumer maps each source event to `Patch::Updated(Entity)` or `Patch::Deleted(Entity)`. Entity-property updates, deletions, and clears map to updated Soup entities; property task entities map to their document representation. Property definition and option lifecycle events are ignored because they do not identify every affected entity. The domain service expands current access, adds the users of any recorded grants the patch carries, and publishes one patch per recipient to `macro.soup`; it does not hydrate or serialize `SoupItem` values. Channel threads use their containing channel as the access source. Permanent deletes remove access before the consumer can read it, so `document.purged` and `initiative.purged` carry the grants (user, channel and team sources) their producer read first, expanded to users when the patch is processed; a `document.purged` without them is ignored because its soft delete was already announced.

The Soup topic carries `Patch<(MacroUserIdStr<'static>, Entity<'static>)>` and is also keyed by recipient user ID. Delivery is at least once: offsets are committed only after successful fan-out, and exhausted retries stop the consumer so its supervisor can restart it for redelivery. Downstream consumers must tolerate duplicate patches.

`SoupRealtimeConsumerService` consumes recipient-targeted patches and distributes `Patch<Entity<'static>>` values through instance-local, user-keyed subscriptions.
