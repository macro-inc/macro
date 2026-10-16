# Type Alias: PropertyDefinitionDetailResponse

> **PropertyDefinitionDetailResponse** = [`PropertyOwner`](PropertyOwner.md) & \{ `createdAt?`: `string` \| `null`; `dataType`: [`DataType`](DataType.md); `displayName`: `string`; `id`: `string`; `isMetadata`: `boolean`; `isMultiSelect`: `boolean`; `isSystem`: `boolean`; `specificEntityType?`: `null` \| [`EntityType`](EntityType.md); `updatedAt?`: `string` \| `null`; \}

Property definition response (API representation).

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `createdAt?` | `string` \| `null` | - |
| `dataType` | [`DataType`](DataType.md) | - |
| `displayName` | `string` | - |
| `id` | `string` | - |
| `isMetadata` | `boolean` | Flag to indicate if this is a system-generated metadata property |
| `isMultiSelect` | `boolean` | - |
| `isSystem` | `boolean` | Flag to indicate if this is a system property (managed by the system) |
| `specificEntityType?` | `null` \| [`EntityType`](EntityType.md) | - |
| `updatedAt?` | `string` \| `null` | - |
