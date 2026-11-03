# Type Alias: Database

> **Database** = \{ `appearance?`: `null` \| [`EntityAppearance`](EntityAppearance.md); `created_at`: `string`; `id`: `string`; `name`: `string`; `owner_id`: `string`; `project_id`: `string` \| `null`; `trashed_at`: `string` \| `null`; \}

A database: a named collection of tables, owned and shared as one entity.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-appearance"></a> `appearance?` | `null` \| [`EntityAppearance`](EntityAppearance.md) | - |
| <a id="property-created_at"></a> `created_at` | `string` | Creation time. |
| <a id="property-id"></a> `id` | `string` | Identifier. |
| <a id="property-name"></a> `name` | `string` | Display name. |
| <a id="property-owner_id"></a> `owner_id` | `string` | Owning user. |
| <a id="property-project_id"></a> `project_id` | `string` \| `null` | The folder it is filed in; `null` at the root. |
| <a id="property-trashed_at"></a> `trashed_at` | `string` \| `null` | Set when trashed. |
