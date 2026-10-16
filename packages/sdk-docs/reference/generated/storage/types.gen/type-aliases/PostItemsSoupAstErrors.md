# Type Alias: PostItemsSoupAstErrors

> **PostItemsSoupAstErrors** = \{ `403`: [`ErrorResponse`](ErrorResponse.md); `404`: [`ErrorResponse`](ErrorResponse.md); `500`: [`ErrorResponse`](ErrorResponse.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-403"></a> `403` | [`ErrorResponse`](ErrorResponse.md) | CRM-scoped queries require team membership, or requesting hidden CRM companies requires admin/owner team role |
| <a id="property-404"></a> `404` | [`ErrorResponse`](ErrorResponse.md) | The CRM record named by `crma` or a document `crm` literal is not visible to the caller |
| <a id="property-500"></a> `500` | [`ErrorResponse`](ErrorResponse.md) | - |
