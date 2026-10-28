# Type Alias: EventFilter

> **EventFilter** = \{ `condition?`: `string` \| `null`; `events`: [`EventName`](EventName.md)[]; `ids?`: `string`[] \| `null`; \}

An event name AND an entity ID must match within the same filter. A
condition further requires the event's content to answer it with yes.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-condition"></a> `condition?` | `string` \| `null` | Yes/no question about the triggering content, e.g. "Is this email an invoice?". The routine runs only when the answer is yes. |
| <a id="property-events"></a> `events` | [`EventName`](EventName.md)[] | - |
| <a id="property-ids"></a> `ids?` | `string`[] \| `null` | - |
