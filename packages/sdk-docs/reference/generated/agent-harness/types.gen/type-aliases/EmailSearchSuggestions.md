# Type Alias: EmailSearchSuggestions

> **EmailSearchSuggestions** = \{ `importance?`: `string` \| `null`; `inboxes`: `string`[]; `query?`: `string` \| `null`; \}

Email search exposes importance and connected inbox addresses, not sender filters.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-importance"></a> `importance?` | `string` \| `null` | Explicit importance wording, resolved by the client. |
| <a id="property-inboxes"></a> `inboxes` | `string`[] | Explicit connected inbox addresses, resolved by the client. |
| <a id="property-query"></a> `query?` | `string` \| `null` | Remaining keyword phrase. |
