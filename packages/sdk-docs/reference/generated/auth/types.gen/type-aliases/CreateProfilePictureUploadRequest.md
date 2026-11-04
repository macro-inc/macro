# Type Alias: CreateProfilePictureUploadRequest

> **CreateProfilePictureUploadRequest** = \{ `content_type`: `string`; `file_name`: `string`; `size_bytes`: `number`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-content_type"></a> `content_type` | `string` | Mime type of the image. |
| <a id="property-file_name"></a> `file_name` | `string` | File name, such as `avatar.png`. |
| <a id="property-size_bytes"></a> `size_bytes` | `number` | Exact size of the image in bytes. Storage rejects a body of any other size. |
