# Type Alias: UserApiKeyInfo

> **UserApiKeyInfo** = \{ `createdAt`: `string`; `id`: [`UserApiKeyId`](UserApiKeyId.md); `name`: `string`; \}

Safe metadata for a stored key. Never contains the secret or its hash.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-createdat"></a> `createdAt` | `string` | When the key was created. |
| <a id="property-id"></a> `id` | [`UserApiKeyId`](UserApiKeyId.md) | Opaque identifier used to address the key after create. |
| <a id="property-name"></a> `name` | `string` | User-facing name. |
