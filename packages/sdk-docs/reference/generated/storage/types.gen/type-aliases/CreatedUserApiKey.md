# Type Alias: CreatedUserApiKey

> **CreatedUserApiKey** = \{ `createdAt`: `string`; `id`: [`UserApiKeyId`](UserApiKeyId.md); `key`: `string`; `name`: `string`; \}

A newly minted key: safe metadata plus the secret, shown only once.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-createdat"></a> `createdAt` | `string` | When the key was created. |
| <a id="property-id"></a> `id` | [`UserApiKeyId`](UserApiKeyId.md) | Opaque identifier used to address the key after create. |
| <a id="property-key"></a> `key` | `string` | The newly minted secret. Shown only on create. |
| <a id="property-name"></a> `name` | `string` | User-facing name. |
