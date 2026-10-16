# Type Alias: EditCallRecordErrors

> **EditCallRecordErrors** = \{ `400`: [`ErrorResponse`](ErrorResponse.md); `401`: [`ErrorResponse`](ErrorResponse.md); `403`: [`ErrorResponse`](ErrorResponse.md); `404`: [`ErrorResponse`](ErrorResponse.md); `409`: [`ErrorResponse`](ErrorResponse.md); `500`: [`ErrorResponse`](ErrorResponse.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-400"></a> `400` | [`ErrorResponse`](ErrorResponse.md) | Invalid team-share level, contradictory inputs, or the creator has no team |
| <a id="property-401"></a> `401` | [`ErrorResponse`](ErrorResponse.md) | - |
| <a id="property-403"></a> `403` | [`ErrorResponse`](ErrorResponse.md) | Team sharing of an archived call may only be changed by its creator |
| <a id="property-404"></a> `404` | [`ErrorResponse`](ErrorResponse.md) | - |
| <a id="property-409"></a> `409` | [`ErrorResponse`](ErrorResponse.md) | Team-sharing facts changed, or the call was archived mid-request; reload and retry |
| <a id="property-500"></a> `500` | [`ErrorResponse`](ErrorResponse.md) | - |
