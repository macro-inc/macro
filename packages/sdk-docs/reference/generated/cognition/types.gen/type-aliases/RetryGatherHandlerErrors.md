# Type Alias: RetryGatherHandlerErrors

> **RetryGatherHandlerErrors** = \{ `400`: `unknown`; `402`: [`AiAdmissionErrorBody`](AiAdmissionErrorBody.md); `500`: `unknown`; `503`: [`AiAdmissionErrorBody`](AiAdmissionErrorBody.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-400"></a> `400` | `unknown` | Unknown import source |
| <a id="property-402"></a> `402` | [`AiAdmissionErrorBody`](AiAdmissionErrorBody.md) | AI allowance exhausted |
| <a id="property-500"></a> `500` | `unknown` | Internal server error |
| <a id="property-503"></a> `503` | [`AiAdmissionErrorBody`](AiAdmissionErrorBody.md) | AI usage validation unavailable; retry later |
