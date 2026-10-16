# Class: DatabaseWebhook

A webhook of a [DatabaseTable](../../table/classes/DatabaseTable.md): a secret URL that anyone holding it
can POST JSON to, each object becoming a row, written with the access of
the user who created it. Its token is shown only when it is created; see
Database.createWebhook.

## Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-createdby"></a> `createdBy` | `readonly` | [`User`](../../../users/user/classes/User.md) | Who created it; its calls write with their access. |
| <a id="property-id"></a> `id` | `readonly` | `string` | Identifier of the webhook. |
| <a id="property-table"></a> `table` | `readonly` | [`DatabaseTable`](../../table/classes/DatabaseTable.md) | The table its calls insert rows into. |

## Accessors

### createdAt

#### Get Signature

> **get** **createdAt**(): `string`

When it was created.

##### Returns

`string`

***

### tokenPrefix

#### Get Signature

> **get** **tokenPrefix**(): `string`

The token's first characters, to tell webhooks apart without the secret.

##### Returns

`string`

## Methods

### delete()

> **delete**(): `Promise`\<`void`\>

Delete the webhook; its URL stops working.

#### Returns

`Promise`\<`void`\>

***

### toJSON()

> **toJSON**(): \{ `id`: `string`; `tableId`: `string`; `tokenPrefix`: `string`; \}

#### Returns

\{ `id`: `string`; `tableId`: `string`; `tokenPrefix`: `string`; \}

| Name | Type |
| ------ | ------ |
| `id` | `string` |
| `tableId` | `string` |
| `tokenPrefix` | `string` |

***

### fromRecord()

> `static` **fromRecord**(`table`, `createdBy`, `record`): `DatabaseWebhook`

A handle from the record the API answered.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `table` | [`DatabaseTable`](../../table/classes/DatabaseTable.md) |
| `createdBy` | [`User`](../../../users/user/classes/User.md) |
| `record` | [`DatabaseWebhookResponse`](../../../../../generated/storage/types.gen/type-aliases/DatabaseWebhookResponse.md) |

#### Returns

`DatabaseWebhook`
