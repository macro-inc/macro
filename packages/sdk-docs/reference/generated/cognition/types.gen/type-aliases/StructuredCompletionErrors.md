# Type Alias: StructuredCompletionErrors

> **StructuredCompletionErrors** = \{ `400`: [`StructuredCompletionError`](StructuredCompletionError.md); `401`: `unknown`; `402`: [`StructuredCompletionError`](StructuredCompletionError.md); `403`: [`StructuredCompletionError`](StructuredCompletionError.md); `500`: [`StructuredCompletionError`](StructuredCompletionError.md); `503`: [`StructuredCompletionError`](StructuredCompletionError.md); `504`: [`StructuredCompletionError`](StructuredCompletionError.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-400"></a> `400` | [`StructuredCompletionError`](StructuredCompletionError.md) | Bad request |
| <a id="property-401"></a> `401` | `unknown` | Unauthorized |
| <a id="property-402"></a> `402` | [`StructuredCompletionError`](StructuredCompletionError.md) | Payment required |
| <a id="property-403"></a> `403` | [`StructuredCompletionError`](StructuredCompletionError.md) | No access to the requested model |
| <a id="property-500"></a> `500` | [`StructuredCompletionError`](StructuredCompletionError.md) | Internal error |
| <a id="property-503"></a> `503` | [`StructuredCompletionError`](StructuredCompletionError.md) | AI usage validation unavailable — retry later |
| <a id="property-504"></a> `504` | [`StructuredCompletionError`](StructuredCompletionError.md) | Tool-free completion deadline exceeded |
