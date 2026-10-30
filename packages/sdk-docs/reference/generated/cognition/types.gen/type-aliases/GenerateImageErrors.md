# Type Alias: GenerateImageErrors

> **GenerateImageErrors** = \{ `400`: [`GenerateImageErrorBody`](GenerateImageErrorBody.md); `401`: `unknown`; `402`: [`GenerateImageErrorBody`](GenerateImageErrorBody.md); `403`: [`GenerateImageErrorBody`](GenerateImageErrorBody.md); `422`: [`GenerateImageErrorBody`](GenerateImageErrorBody.md); `500`: [`GenerateImageErrorBody`](GenerateImageErrorBody.md); `502`: [`GenerateImageErrorBody`](GenerateImageErrorBody.md); `503`: [`GenerateImageErrorBody`](GenerateImageErrorBody.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-400"></a> `400` | [`GenerateImageErrorBody`](GenerateImageErrorBody.md) | Invalid prompt or reference |
| <a id="property-401"></a> `401` | `unknown` | Unauthorized |
| <a id="property-402"></a> `402` | [`GenerateImageErrorBody`](GenerateImageErrorBody.md) | AI allowance exhausted |
| <a id="property-403"></a> `403` | [`GenerateImageErrorBody`](GenerateImageErrorBody.md) | A reference is not accessible, or no user to bill |
| <a id="property-422"></a> `422` | [`GenerateImageErrorBody`](GenerateImageErrorBody.md) | The model declined to render the prompt |
| <a id="property-500"></a> `500` | [`GenerateImageErrorBody`](GenerateImageErrorBody.md) | The image could not be read or stored |
| <a id="property-502"></a> `502` | [`GenerateImageErrorBody`](GenerateImageErrorBody.md) | The image model request failed |
| <a id="property-503"></a> `503` | [`GenerateImageErrorBody`](GenerateImageErrorBody.md) | Image generation or usage validation unavailable |
