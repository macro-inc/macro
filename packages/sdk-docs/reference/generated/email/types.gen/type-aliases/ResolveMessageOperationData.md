# Type Alias: ResolveMessageOperationData

> **ResolveMessageOperationData** = \{ `body`: [`ResolveMessageOperationRequest`](ResolveMessageOperationRequest.md); `path`: \{ `id`: `string`; \}; `query?`: `never`; `url`: `"/email/drafts/{id}/resolve"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`ResolveMessageOperationRequest`](ResolveMessageOperationRequest.md) | - |
| <a id="property-path"></a> `path` | \{ `id`: `string`; \} | - |
| `path.id` | `string` | Message ID |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/email/drafts/{id}/resolve"` | - |
