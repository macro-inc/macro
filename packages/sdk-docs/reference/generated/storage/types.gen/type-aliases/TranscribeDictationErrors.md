# Type Alias: TranscribeDictationErrors

> **TranscribeDictationErrors** = \{ `400`: [`ErrorResponse`](ErrorResponse.md); `401`: [`ErrorResponse`](ErrorResponse.md); `403`: [`ErrorResponse`](ErrorResponse.md); `413`: `unknown`; `415`: [`ErrorResponse`](ErrorResponse.md); `429`: `unknown`; `502`: [`ErrorResponse`](ErrorResponse.md); `503`: [`ErrorResponse`](ErrorResponse.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-400"></a> `400` | [`ErrorResponse`](ErrorResponse.md) | Empty, oversized, or malformed request |
| <a id="property-401"></a> `401` | [`ErrorResponse`](ErrorResponse.md) | Missing or invalid credentials |
| <a id="property-403"></a> `403` | [`ErrorResponse`](ErrorResponse.md) | Only signed-in users may dictate |
| <a id="property-413"></a> `413` | `unknown` | Body exceeds 8 MiB |
| <a id="property-415"></a> `415` | [`ErrorResponse`](ErrorResponse.md) | Unsupported audio container |
| <a id="property-429"></a> `429` | `unknown` | Per-user hourly rate limit exceeded |
| <a id="property-502"></a> `502` | [`ErrorResponse`](ErrorResponse.md) | Provider failure |
| <a id="property-503"></a> `503` | [`ErrorResponse`](ErrorResponse.md) | Transcription capacity exhausted; retry after the Retry-After delay |
