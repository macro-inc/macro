# Type Alias: EditDocumentWithAiErrors

> **EditDocumentWithAiErrors** = \{ `400`: [`ErrorResponse`](ErrorResponse.md); `401`: `unknown`; `402`: [`AiAdmissionErrorBody`](AiAdmissionErrorBody.md); `403`: `unknown`; `404`: `unknown`; `422`: [`DocumentAiEditRefused`](DocumentAiEditRefused.md); `500`: [`ErrorResponse`](ErrorResponse.md); `502`: [`DocumentAiEditFailed`](DocumentAiEditFailed.md); `503`: [`AiAdmissionErrorBody`](AiAdmissionErrorBody.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-400"></a> `400` | [`ErrorResponse`](ErrorResponse.md) | Not a markdown document, or empty instructions |
| <a id="property-401"></a> `401` | `unknown` | Authentication required |
| <a id="property-402"></a> `402` | [`AiAdmissionErrorBody`](AiAdmissionErrorBody.md) | AI allowance exhausted |
| <a id="property-403"></a> `403` | `unknown` | Document edit access denied |
| <a id="property-404"></a> `404` | `unknown` | Document not found |
| <a id="property-422"></a> `422` | [`DocumentAiEditRefused`](DocumentAiEditRefused.md) | The editor could not do the edit; nothing changed |
| <a id="property-500"></a> `500` | [`ErrorResponse`](ErrorResponse.md) | The edit could not start |
| <a id="property-502"></a> `502` | [`DocumentAiEditFailed`](DocumentAiEditFailed.md) | The edit failed and may have partly applied |
| <a id="property-503"></a> `503` | [`AiAdmissionErrorBody`](AiAdmissionErrorBody.md) | AI usage validation unavailable; retry later |
