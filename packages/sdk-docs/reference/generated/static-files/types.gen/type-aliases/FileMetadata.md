# Type Alias: FileMetadata

> **FileMetadata** = \{ `content_type`: `string`; `extension_data?`: `unknown`; `file_id`: `string`; `file_name`: `string`; `is_uploaded`: `boolean`; `owner_id`: `string`; `s3_key`: `string`; \}

File metadata for static files

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-content_type"></a> `content_type` | `string` | mimetype |
| <a id="property-extension_data"></a> `extension_data?` | `unknown` | extra metadata, uploaded with the file |
| <a id="property-file_id"></a> `file_id` | `string` | id of static file |
| <a id="property-file_name"></a> `file_name` | `string` | file name |
| <a id="property-is_uploaded"></a> `is_uploaded` | `boolean` | is data uploaded to s3 |
| <a id="property-owner_id"></a> `owner_id` | `string` | owner |
| <a id="property-s3_key"></a> `s3_key` | `string` | s3 key |
