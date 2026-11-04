# Type Alias: ProfilePictureUpload

> **ProfilePictureUpload** = \{ `file_id`: `string`; `upload_url`: `string`; \}

Where to upload a new profile picture, and the file id to set afterwards.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-file_id"></a> `file_id` | `string` | Id to pass to `PUT /user/profile_picture/file` once uploaded. |
| <a id="property-upload_url"></a> `upload_url` | `string` | Expiring URL to `PUT` the image bytes to. |
