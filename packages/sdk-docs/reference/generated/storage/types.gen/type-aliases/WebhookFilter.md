# Type Alias: WebhookFilter

> **WebhookFilter** = \{ `events`: `string`[]; `ids?`: `string`[] \| `null`; \}

Event and optional entity-id constraints used to match webhook deliveries.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-events"></a> `events` | `string`[] | Event names matched by this filter. |
| <a id="property-ids"></a> `ids?` | `string`[] \| `null` | Entity ids matched by this filter. When absent, the filter matches all entity ids. |
