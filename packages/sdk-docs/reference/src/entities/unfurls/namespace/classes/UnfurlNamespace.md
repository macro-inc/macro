# Class: UnfurlNamespace

URL metadata lookup.

## Constructors

### Constructor

> **new UnfurlNamespace**(`client`): `UnfurlNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`UnfurlNamespace`

## Methods

### bulk()

> **bulk**(`urls`): `Promise`\<[`GetUnfurlBulkResponse`](../../../../../generated/unfurl/types.gen/type-aliases/GetUnfurlBulkResponse.md)\>

Read metadata for multiple URLs in one request.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `urls` | `string`[] |

#### Returns

`Promise`\<[`GetUnfurlBulkResponse`](../../../../../generated/unfurl/types.gen/type-aliases/GetUnfurlBulkResponse.md)\>

***

### get()

> **get**(`url`): `Promise`\<[`GetUnfurlResponse`](../../../../../generated/unfurl/types.gen/type-aliases/GetUnfurlResponse.md)\>

Read title, description and preview metadata for a URL.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `url` | `string` |

#### Returns

`Promise`\<[`GetUnfurlResponse`](../../../../../generated/unfurl/types.gen/type-aliases/GetUnfurlResponse.md)\>
