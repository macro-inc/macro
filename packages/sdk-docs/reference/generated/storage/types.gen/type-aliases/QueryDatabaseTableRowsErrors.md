# Type Alias: QueryDatabaseTableRowsErrors

> **QueryDatabaseTableRowsErrors** = \{ `400`: [`OpRefusalResponse`](OpRefusalResponse.md); `401`: [`ErrorResponse`](ErrorResponse.md); `403`: [`ErrorResponse`](ErrorResponse.md); `404`: [`ErrorResponse`](ErrorResponse.md); `409`: [`ErrorResponse`](ErrorResponse.md); `500`: [`ErrorResponse`](ErrorResponse.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-400"></a> `400` | [`OpRefusalResponse`](OpRefusalResponse.md) | The query does not apply to the table |
| <a id="property-401"></a> `401` | [`ErrorResponse`](ErrorResponse.md) | Missing or invalid credentials |
| <a id="property-403"></a> `403` | [`ErrorResponse`](ErrorResponse.md) | No access to the database |
| <a id="property-404"></a> `404` | [`ErrorResponse`](ErrorResponse.md) | - |
| <a id="property-409"></a> `409` | [`ErrorResponse`](ErrorResponse.md) | The table changed during the read, or no longer holds `after` |
| <a id="property-500"></a> `500` | [`ErrorResponse`](ErrorResponse.md) | - |
