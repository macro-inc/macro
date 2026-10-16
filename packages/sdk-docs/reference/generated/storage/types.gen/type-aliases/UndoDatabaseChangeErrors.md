# Type Alias: UndoDatabaseChangeErrors

> **UndoDatabaseChangeErrors** = \{ `401`: [`ErrorResponse`](ErrorResponse.md); `403`: [`ErrorResponse`](ErrorResponse.md); `404`: [`ErrorResponse`](ErrorResponse.md); `409`: [`ErrorResponse`](ErrorResponse.md); `500`: [`ErrorResponse`](ErrorResponse.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-401"></a> `401` | [`ErrorResponse`](ErrorResponse.md) | Missing or invalid credentials |
| <a id="property-403"></a> `403` | [`ErrorResponse`](ErrorResponse.md) | No edit access to the database |
| <a id="property-404"></a> `404` | [`ErrorResponse`](ErrorResponse.md) | No such change in this database |
| <a id="property-409"></a> `409` | [`ErrorResponse`](ErrorResponse.md) | The table kept moving under the undo |
| <a id="property-500"></a> `500` | [`ErrorResponse`](ErrorResponse.md) | - |
