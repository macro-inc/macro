# Type Alias: CodexEnvironment

> **CodexEnvironment** = \{ `id`: `string`; `label?`: `string` \| `null`; `repositories`: [`CodexEnvironmentRepository`](CodexEnvironmentRepository.md)[]; \}

A cloud environment visible to the connected provider account.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-id"></a> `id` | `string` | Provider environment identity. |
| <a id="property-label"></a> `label?` | `string` \| `null` | Human-readable provider label. |
| <a id="property-repositories"></a> `repositories` | [`CodexEnvironmentRepository`](CodexEnvironmentRepository.md)[] | Ordered safe repository identities from Codex. |
