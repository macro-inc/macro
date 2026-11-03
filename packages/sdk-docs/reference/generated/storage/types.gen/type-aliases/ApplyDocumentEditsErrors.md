# Type Alias: ApplyDocumentEditsErrors

> **ApplyDocumentEditsErrors** = \{ `400`: [`ErrorResponse`](ErrorResponse.md); `401`: `unknown`; `403`: `unknown`; `404`: `unknown`; `422`: [`DocumentEditRejected`](DocumentEditRejected.md); `500`: [`ErrorResponse`](ErrorResponse.md); `502`: [`DocumentEditUnacknowledged`](DocumentEditUnacknowledged.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-400"></a> `400` | [`ErrorResponse`](ErrorResponse.md) | Not a markdown document, or malformed ops |
| <a id="property-401"></a> `401` | `unknown` | Authentication required |
| <a id="property-403"></a> `403` | `unknown` | Document edit access denied |
| <a id="property-404"></a> `404` | `unknown` | Document not found |
| <a id="property-422"></a> `422` | [`DocumentEditRejected`](DocumentEditRejected.md) | Ops failed against the live document; nothing was committed |
| <a id="property-500"></a> `500` | [`ErrorResponse`](ErrorResponse.md) | Editing failed; nothing was committed |
| <a id="property-502"></a> `502` | [`DocumentEditUnacknowledged`](DocumentEditUnacknowledged.md) | Outcome unknown: the edit may have applied |
