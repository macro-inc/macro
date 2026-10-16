# Type Alias: UserApiKeysList

> **UserApiKeysList** = \{ `keys`: [`UserApiKeyInfo`](UserApiKeyInfo.md)[]; \}

The caller's API keys as id, name, and created_at.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-keys"></a> `keys` | [`UserApiKeyInfo`](UserApiKeyInfo.md)[] | The caller's keys. Never includes the raw secret or hash. |
