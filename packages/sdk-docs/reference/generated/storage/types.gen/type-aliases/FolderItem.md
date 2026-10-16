# Type Alias: FolderItem

> **FolderItem** = \{ `fileType?`: `null` \| [`FileType`](FileType.md); `fullName`: `string`; `name`: `string`; `relativePath`: `string`; `sha`: `string`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-filetype"></a> `fileType?` | `null` \| [`FileType`](FileType.md) | - |
| <a id="property-fullname"></a> `fullName` | `string` | The full OS name of the file for deduplication |
| <a id="property-name"></a> `name` | `string` | The name of the file, without the extension |
| <a id="property-relativepath"></a> `relativePath` | `string` | The relative path of the file. This is the `webkitRelativePath` with the name of the file stripped at the end. |
| <a id="property-sha"></a> `sha` | `string` | The sha of the file. |
