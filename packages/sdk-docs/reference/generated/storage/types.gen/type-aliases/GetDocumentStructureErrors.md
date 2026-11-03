# Type Alias: GetDocumentStructureErrors

> **GetDocumentStructureErrors** = \{ `400`: [`ErrorResponse`](ErrorResponse.md); `401`: `unknown`; `403`: `unknown`; `404`: `unknown`; `500`: [`ErrorResponse`](ErrorResponse.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-400"></a> `400` | [`ErrorResponse`](ErrorResponse.md) | Not a markdown document |
| <a id="property-401"></a> `401` | `unknown` | Authentication required |
| <a id="property-403"></a> `403` | `unknown` | Document access denied |
| <a id="property-404"></a> `404` | `unknown` | Document not found |
| <a id="property-500"></a> `500` | [`ErrorResponse`](ErrorResponse.md) | Document structure unavailable |
