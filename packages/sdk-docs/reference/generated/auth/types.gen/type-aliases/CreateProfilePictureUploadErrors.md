# Type Alias: CreateProfilePictureUploadErrors

> **CreateProfilePictureUploadErrors** = \{ `400`: [`ErrorResponse`](ErrorResponse.md); `401`: `string`; `413`: [`ErrorResponse`](ErrorResponse.md); `429`: [`ErrorResponse`](ErrorResponse.md); `500`: [`ErrorResponse`](ErrorResponse.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-400"></a> `400` | [`ErrorResponse`](ErrorResponse.md) | Not a supported image type, or empty |
| <a id="property-401"></a> `401` | `string` | - |
| <a id="property-413"></a> `413` | [`ErrorResponse`](ErrorResponse.md) | The image is larger than 16 MB |
| <a id="property-429"></a> `429` | [`ErrorResponse`](ErrorResponse.md) | Too many uploads this hour |
| <a id="property-500"></a> `500` | [`ErrorResponse`](ErrorResponse.md) | - |
