# Type Alias: UploadFolderRequest

> **UploadFolderRequest** = \{ `content`: [`FolderItem`](FolderItem.md)[]; `folders?`: `string`[]; `parentId?`: `string` \| `null`; `rootFolderName`: `string`; `uploadRequestId`: `string`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-content"></a> `content` | [`FolderItem`](FolderItem.md)[] | The content of the folder |
| <a id="property-folders"></a> `folders?` | `string`[] | Relative paths of folders to create even when they hold no files. Uses the same shape as [FolderItem::relative_path], root folder included. |
| <a id="property-parentid"></a> `parentId?` | `string` \| `null` | Optional parent project id to upload the folder into |
| <a id="property-rootfoldername"></a> `rootFolderName` | `string` | The name of the folder you are uploading. This is used to help us generate the folder map more easily. |
| <a id="property-uploadrequestid"></a> `uploadRequestId` | `string` | The upload request id |
