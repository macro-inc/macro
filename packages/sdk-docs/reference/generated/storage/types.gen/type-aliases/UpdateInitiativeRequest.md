# Type Alias: UpdateInitiativeRequest

> **UpdateInitiativeRequest** = \{ `memberIds?`: `string`[] \| `null`; `name?`: `string` \| `null`; `sharePermission?`: `null` \| [`UpdateSharePermissionRequestV2`](UpdateSharePermissionRequestV2.md); \}

Update-initiative HTTP body. Absent fields are left unchanged. `member_ids`
present is a full replace. The description is edited in its collab surface, not here.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-memberids"></a> `memberIds?` | `string`[] \| `null` | Full replacement collaborator list when present. Only the owner may send this field. |
| <a id="property-name"></a> `name?` | `string` \| `null` | Replacement name. |
| <a id="property-sharepermission"></a> `sharePermission?` | `null` \| [`UpdateSharePermissionRequestV2`](UpdateSharePermissionRequestV2.md) | - |
