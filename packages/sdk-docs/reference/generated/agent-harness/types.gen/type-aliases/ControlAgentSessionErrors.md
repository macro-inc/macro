# Type Alias: ControlAgentSessionErrors

> **ControlAgentSessionErrors** = \{ `401`: `string`; `402`: [`AiAdmissionErrorBody`](AiAdmissionErrorBody.md); `403`: `string`; `422`: `string`; `500`: `string`; `503`: [`AiAdmissionErrorBody`](AiAdmissionErrorBody.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-401"></a> `401` | `string` | - |
| <a id="property-402"></a> `402` | [`AiAdmissionErrorBody`](AiAdmissionErrorBody.md) | AI allowance exhausted |
| <a id="property-403"></a> `403` | `string` | - |
| <a id="property-422"></a> `422` | `string` | - |
| <a id="property-500"></a> `500` | `string` | - |
| <a id="property-503"></a> `503` | [`AiAdmissionErrorBody`](AiAdmissionErrorBody.md) | AI usage validation unavailable, or replica draining; retry later |
