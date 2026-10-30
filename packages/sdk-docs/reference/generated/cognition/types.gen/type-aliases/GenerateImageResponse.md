# Type Alias: GenerateImageResponse

> **GenerateImageResponse** = \{ `height`: `number`; `mimeType`: `string`; `note?`: `string` \| `null`; `sizeBytes`: `number`; `staticFileId`: `string`; `url`: `string`; `width`: `number`; \}

The stored generated image.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-height"></a> `height` | `number` | Intrinsic pixel height. |
| <a id="property-mimetype"></a> `mimeType` | `string` | IANA media type of the image, e.g. `image/png`. |
| <a id="property-note"></a> `note?` | `string` \| `null` | Commentary the model produced alongside the image, when any. |
| <a id="property-sizebytes"></a> `sizeBytes` | `number` | Size of the image in bytes. |
| <a id="property-staticfileid"></a> `staticFileId` | `string` | Static file ID, reusable as a reference image or a message attachment. |
| <a id="property-url"></a> `url` | `string` | Permanent URL of the image. |
| <a id="property-width"></a> `width` | `number` | Intrinsic pixel width. |
