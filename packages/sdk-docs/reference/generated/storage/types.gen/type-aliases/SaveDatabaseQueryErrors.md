# Type Alias: SaveDatabaseQueryErrors

> **SaveDatabaseQueryErrors** = \{ `401`: [`ErrorResponse`](ErrorResponse.md); `404`: [`ErrorResponse`](ErrorResponse.md); `422`: [`ErrorResponse`](ErrorResponse.md); `500`: [`ErrorResponse`](ErrorResponse.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-401"></a> `401` | [`ErrorResponse`](ErrorResponse.md) | Missing or invalid credentials |
| <a id="property-404"></a> `404` | [`ErrorResponse`](ErrorResponse.md) | The database is missing or not visible |
| <a id="property-422"></a> `422` | [`ErrorResponse`](ErrorResponse.md) | The query is too long |
| <a id="property-500"></a> `500` | [`ErrorResponse`](ErrorResponse.md) | - |
