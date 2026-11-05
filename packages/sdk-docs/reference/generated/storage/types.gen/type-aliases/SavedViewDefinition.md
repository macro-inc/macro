# Type Alias: SavedViewDefinition

> **SavedViewDefinition** = \{ `config`: \{\[`key`: `string`\]: `unknown`; \}; `createdAt`: `string`; `id`: `string`; `name`: `string`; `ownerId`: `string`; `revision`: `number`; `sharedTeamId?`: `string` \| `null`; `updatedAt`: `string`; \}

A saved filter definition, not a snapshot of matching entities.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-config"></a> `config` | \{\[`key`: `string`\]: `unknown`; \} | Versioned configuration interpreted by the consuming feature, with its `kind` (such as `email` or `task`) and `version`. |
| <a id="property-createdat"></a> `createdAt` | `string` | - |
| <a id="property-id"></a> `id` | `string` | Stable identity of this definition. |
| <a id="property-name"></a> `name` | `string` | Display name chosen by the owner. |
| <a id="property-ownerid"></a> `ownerId` | `string` | User who owns and can edit this definition. |
| <a id="property-revision"></a> `revision` | `number` | Current revision, required by updates and deletion. |
| <a id="property-sharedteamid"></a> `sharedTeamId?` | `string` \| `null` | Team with access, or absent when the definition is private. |
| <a id="property-updatedat"></a> `updatedAt` | `string` | - |
