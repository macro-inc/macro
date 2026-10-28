# Class: Webhook

A webhook registration: an HTTPS endpoint Macro delivers signed entity
events to.

A free-to-construct `(client, id)` handle like any other entity: the detail
record loads lazily from the webhook GET endpoint on first field access and
is dropped after any mutation. WebhooksNamespace.list enumerates the
caller's webhooks across their personal and team workspaces.

The signing secret is only ever returned once, from [create](#create); it's
exposed there as [Webhook.signingSecret](#property-signingsecret). Save it — patches, gets,
and `byId` handles never carry it again — and pass it to
`MacroOpts.webhookSecret` so `macro.events.webhook()` can verify
deliveries. Live SSE via `macro.events.listen()` does not use a
persisted webhook or signing secret.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`Webhook`](../../../../../generated/storage/types.gen/type-aliases/Webhook.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-createdat"></a> `createdAt` | `readonly` | () => `Promise`\<`string`\> | When the webhook was created. | - |
| <a id="property-createdby"></a> `createdBy` | `readonly` | () => `Promise`\<[`User`](../../../users/user/classes/User.md)\> | The user who registered this webhook. | - |
| <a id="property-endpointurl"></a> `endpointUrl` | `readonly` | () => `Promise`\<`string`\> | The HTTPS endpoint URL deliveries are sent to. | - |
| <a id="property-filters"></a> `filters` | `readonly` | () => `Promise`\<[`Vec`](../../../../../generated/storage/types.gen/type-aliases/Vec.md)\> | The event/entity-id filters that gate deliveries. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-isvalid"></a> `isValid` | `readonly` | () => `Promise`\<`boolean`\> | Whether the current endpoint configuration has passed validation. | - |
| <a id="property-name"></a> `name` | `readonly` | () => `Promise`\<`string`\> | The webhook's display name. | - |
| <a id="property-namespace"></a> `namespace` | `readonly` | () => `Promise`\<`string`\> | The caller-chosen namespace, unique among the owning workspace's webhooks. Fixed at creation time; it cannot be patched. | - |
| <a id="property-signingsecret"></a> `signingSecret?` | `readonly` | `string` | The signing secret used to verify deliveries, present only on the handle returned by [create](#create). `undefined` for `byId` and listed handles. | - |
| <a id="property-status"></a> `status` | `readonly` | () => `Promise`\<[`WebhookStatus`](../../../../../generated/storage/types.gen/type-aliases/WebhookStatus.md)\> | The webhook's lifecycle status. | - |
| <a id="property-workspaceid"></a> `workspaceId` | `readonly` | () => `Promise`\<`string`\> | The owning workspace id: the creator's user id for a personal webhook, or a team id for a team webhook. | - |

## Methods

### delete()

> **delete**(): `Promise`\<`void`\>

Delete the webhook.

#### Returns

`Promise`\<`void`\>

***

### pause()

> **pause**(): `Promise`\<`void`\>

Pause deliveries.

#### Returns

`Promise`\<`void`\>

***

### rename()

> **rename**(`name`): `Promise`\<`void`\>

Rename the webhook.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |

#### Returns

`Promise`\<`void`\>

***

### resume()

> **resume**(): `Promise`\<`void`\>

Resume deliveries.

#### Returns

`Promise`\<`void`\>

***

### scope()

> **scope**(): `Promise`\<[`WebhookScope`](../../../../../generated/storage/types.gen/type-aliases/WebhookScope.md)\>

Whether this webhook is owned by the caller personally (`user`) or by
their team (`team`). Derived from ownership: a personal webhook's owning
workspace is the creator's own user id, whereas a team webhook's workspace
is a distinct team id.

#### Returns

`Promise`\<[`WebhookScope`](../../../../../generated/storage/types.gen/type-aliases/WebhookScope.md)\>

***

### setFilters()

> **setFilters**(`filters`): `Promise`\<`void`\>

Replace the webhook's delivery filters (must be non-empty).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `filters` | [`WebhookFilter`](../../../../../generated/storage/types.gen/type-aliases/WebhookFilter.md)[] |

#### Returns

`Promise`\<`void`\>

***

### setUrl()

> **setUrl**(`url`): `Promise`\<`void`\>

Point the webhook at a new HTTPS endpoint URL.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `url` | `string` |

#### Returns

`Promise`\<`void`\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`Webhook`](../../../../../generated/storage/types.gen/type-aliases/Webhook.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`Webhook`](../../../../../generated/storage/types.gen/type-aliases/Webhook.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`Webhook`](../../../../../generated/storage/types.gen/type-aliases/Webhook.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### update()

> **update**(`body`): `Promise`\<`void`\>

Update the webhook.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `body` | [`PatchWebhookRequest`](../../../../../generated/storage/types.gen/type-aliases/PatchWebhookRequest.md) |

#### Returns

`Promise`\<`void`\>

***

### validate()

> **validate**(): `Promise`\<[`ValidateWebhookResponse`](../../../../../generated/storage/types.gen/type-aliases/ValidateWebhookResponse.md)\>

Send a signed validation test delivery to the endpoint and report whether
it was accepted. Drops the cached detail so a subsequent [isValid](#property-isvalid)
read reflects the new validation state.

#### Returns

`Promise`\<[`ValidateWebhookResponse`](../../../../../generated/storage/types.gen/type-aliases/ValidateWebhookResponse.md)\>

***

### byId()

> `static` **byId**(`client`, `id`): `Webhook`

A handle to a webhook by id. Details load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`Webhook`

***

### create()

> `static` **create**(`client`, `opts`): `Promise`\<`Webhook`\>

Register a webhook.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `opts` | \{ `filters`: [`WebhookFilter`](../../../../../generated/storage/types.gen/type-aliases/WebhookFilter.md)[]; `headers?`: `Record`\<`string`, `string`\>; `name`: `string`; `namespace`: `string`; `scope?`: [`WebhookScope`](../../../../../generated/storage/types.gen/type-aliases/WebhookScope.md); `url`: `string`; \} |
| `opts.filters` | [`WebhookFilter`](../../../../../generated/storage/types.gen/type-aliases/WebhookFilter.md)[] |
| `opts.headers?` | `Record`\<`string`, `string`\> |
| `opts.name` | `string` |
| `opts.namespace` | `string` |
| `opts.scope?` | [`WebhookScope`](../../../../../generated/storage/types.gen/type-aliases/WebhookScope.md) |
| `opts.url` | `string` |

#### Returns

`Promise`\<`Webhook`\>

***

### fromRecord()

> `static` **fromRecord**(`client`, `record`): `Webhook`

Wrap an already-loaded record.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `record` | [`Webhook`](../../../../../generated/storage/types.gen/type-aliases/Webhook.md) |

#### Returns

`Webhook`
