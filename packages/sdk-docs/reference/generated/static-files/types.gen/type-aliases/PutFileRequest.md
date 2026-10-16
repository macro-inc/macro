# Type Alias: PutFileRequest

> **PutFileRequest** = \{ `content_type?`: `string` \| `null`; `extension_data?`: `unknown`; `file_name`: `string`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-content_type"></a> `content_type?` | `string` \| `null` | optional mime type if type cannot be infered from file_name |
| <a id="property-extension_data"></a> `extension_data?` | `unknown` | extra metadata to store with file don't put anything private in here it is public |
| <a id="property-file_name"></a> `file_name` | `string` | file name |
