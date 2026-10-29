# Class: ApiKeyNamespace

User API key management.

## Constructors

### Constructor

> **new ApiKeyNamespace**(`client`): `ApiKeyNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`ApiKeyNamespace`

## Methods

### byId()

> **byId**(`id`): [`UserApiKey`](../../api-key/classes/UserApiKey.md)

Construct a lazy key handle.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`UserApiKey`](../../api-key/classes/UserApiKey.md)

***

### create()

> **create**(`name`): `Promise`\<\{ `key`: [`UserApiKey`](../../api-key/classes/UserApiKey.md); `secret`: `string`; \}\>

Create a key. Save the secret now; it cannot be retrieved later.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |

#### Returns

`Promise`\<\{ `key`: [`UserApiKey`](../../api-key/classes/UserApiKey.md); `secret`: `string`; \}\>

***

### list()

> **list**(): `Promise`\<[`UserApiKey`](../../api-key/classes/UserApiKey.md)[]\>

List metadata for the caller's API keys.

#### Returns

`Promise`\<[`UserApiKey`](../../api-key/classes/UserApiKey.md)[]\>

***

### tokenForEmail()

> **tokenForEmail**(`email`): `Promise`\<[`MacroApiTokenResponse`](../../../../../generated/auth/types.gen/type-aliases/MacroApiTokenResponse.md)\>

Exchange an email address for a Macro API token, subject to server authorization.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `email` | `string` |

#### Returns

`Promise`\<[`MacroApiTokenResponse`](../../../../../generated/auth/types.gen/type-aliases/MacroApiTokenResponse.md)\>
