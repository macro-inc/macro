# Type Alias: ExecuteScheduledActionNowErrors

> **ExecuteScheduledActionNowErrors** = \{ `400`: `string`; `401`: `string`; `402`: [`AiAdmissionErrorBody`](AiAdmissionErrorBody.md); `404`: `string`; `409`: `string`; `500`: `string`; `503`: [`AiAdmissionErrorBody`](AiAdmissionErrorBody.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-400"></a> `400` | `string` | - |
| <a id="property-401"></a> `401` | `string` | - |
| <a id="property-402"></a> `402` | [`AiAdmissionErrorBody`](AiAdmissionErrorBody.md) | AI allowance exhausted |
| <a id="property-404"></a> `404` | `string` | - |
| <a id="property-409"></a> `409` | `string` | Action is already running |
| <a id="property-500"></a> `500` | `string` | - |
| <a id="property-503"></a> `503` | [`AiAdmissionErrorBody`](AiAdmissionErrorBody.md) | AI usage validation unavailable; retry later |
