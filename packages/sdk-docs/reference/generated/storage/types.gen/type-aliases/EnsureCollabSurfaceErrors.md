# Type Alias: EnsureCollabSurfaceErrors

> **EnsureCollabSurfaceErrors** = \{ `400`: [`ErrorResponse`](ErrorResponse.md); `401`: [`ErrorResponse`](ErrorResponse.md); `403`: [`ErrorResponse`](ErrorResponse.md); `404`: [`ErrorResponse`](ErrorResponse.md); `409`: [`ErrorResponse`](ErrorResponse.md); `410`: [`ErrorResponse`](ErrorResponse.md); `422`: `unknown`; `500`: [`ErrorResponse`](ErrorResponse.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-400"></a> `400` | [`ErrorResponse`](ErrorResponse.md) | - |
| <a id="property-401"></a> `401` | [`ErrorResponse`](ErrorResponse.md) | Missing or invalid credentials |
| <a id="property-403"></a> `403` | [`ErrorResponse`](ErrorResponse.md) | No access to the parent entity |
| <a id="property-404"></a> `404` | [`ErrorResponse`](ErrorResponse.md) | The parent entity does not exist |
| <a id="property-409"></a> `409` | [`ErrorResponse`](ErrorResponse.md) | The surface id is already in use |
| <a id="property-410"></a> `410` | [`ErrorResponse`](ErrorResponse.md) | The surface id was deleted and cannot be reused |
| <a id="property-422"></a> `422` | `unknown` | Malformed request body (plain text) |
| <a id="property-500"></a> `500` | [`ErrorResponse`](ErrorResponse.md) | - |
