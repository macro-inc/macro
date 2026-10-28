# Type Alias: PatchChatRequest

> **PatchChatRequest** = \{ `name?`: `string` \| `null`; `projectId?`: `string` \| `null`; `sharePermission?`: `null` \| [`UpdateSharePermissionRequestV2`](UpdateSharePermissionRequestV2.md); \}

Request body for patching a chat.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-name"></a> `name?` | `string` \| `null` | New name for the chat. |
| <a id="property-projectid"></a> `projectId?` | `string` \| `null` | New project ID for the chat. Empty string clears the project. |
| <a id="property-sharepermission"></a> `sharePermission?` | `null` \| [`UpdateSharePermissionRequestV2`](UpdateSharePermissionRequestV2.md) | - |
