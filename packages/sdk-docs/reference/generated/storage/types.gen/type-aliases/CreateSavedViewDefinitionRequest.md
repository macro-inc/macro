# Type Alias: CreateSavedViewDefinitionRequest

> **CreateSavedViewDefinitionRequest** = \{ `config`: \{\[`key`: `string`\]: `unknown`; \}; `id?`: `string` \| `null`; `name`: `string`; `sharedTeamId?`: `string` \| `null`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-config"></a> `config` | \{\[`key`: `string`\]: `unknown`; \} | Consumer configuration with its `kind` and `version`, at most 32 KiB. |
| <a id="property-id"></a> `id?` | `string` \| `null` | Client-chosen ID, reused to retry the same creation; generated when absent. |
| <a id="property-name"></a> `name` | `string` | Nonempty display name, at most 120 characters. |
| <a id="property-sharedteamid"></a> `sharedTeamId?` | `string` \| `null` | Team to share with, which the creator must belong to. |
