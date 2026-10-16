# Type Alias: SetDocumentTeamShareErrors

> **SetDocumentTeamShareErrors** = \{ `400`: [`ErrorResponse`](ErrorResponse.md); `401`: [`ErrorResponse`](ErrorResponse.md); `404`: [`ErrorResponse`](ErrorResponse.md); `409`: [`ErrorResponse`](ErrorResponse.md); `500`: [`ErrorResponse`](ErrorResponse.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-400"></a> `400` | [`ErrorResponse`](ErrorResponse.md) | Owner has no team |
| <a id="property-401"></a> `401` | [`ErrorResponse`](ErrorResponse.md) | Acting identity is absent or is not the actual owner |
| <a id="property-404"></a> `404` | [`ErrorResponse`](ErrorResponse.md) | - |
| <a id="property-409"></a> `409` | [`ErrorResponse`](ErrorResponse.md) | Sharing facts changed or an untracked grant conflicts |
| <a id="property-500"></a> `500` | [`ErrorResponse`](ErrorResponse.md) | - |
