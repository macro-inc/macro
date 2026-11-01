# Class: WebhooksNamespace

Webhook registrations for receiving signed entity-event deliveries.

## Constructors

### Constructor

> **new WebhooksNamespace**(`client`): `WebhooksNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`WebhooksNamespace`

## Methods

### byId()

> **byId**(`id`): [`Webhook`](../../webhook/classes/Webhook.md)

A handle to an existing webhook by id. Details load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`Webhook`](../../webhook/classes/Webhook.md)

***

### create()

> **create**(`opts`): `Promise`\<[`Webhook`](../../webhook/classes/Webhook.md)\>

Register a webhook. `namespace` must be unique among the owning
workspace's webhooks (the endpoint returns 409 on a clash) and cannot be
changed later. `filters` must be non-empty (each entry matches event
names, optionally narrowed to entity ids); `scope` defaults to `'user'`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts` | \{ `filters`: [`WebhookFilter`](../../../../../generated/storage/types.gen/type-aliases/WebhookFilter.md)[]; `headers?`: `Record`\<`string`, `string`\>; `name`: `string`; `namespace`: `string`; `scope?`: [`WebhookScope`](../../../../../generated/storage/types.gen/type-aliases/WebhookScope.md); `url`: `string`; \} |
| `opts.filters` | [`WebhookFilter`](../../../../../generated/storage/types.gen/type-aliases/WebhookFilter.md)[] |
| `opts.headers?` | `Record`\<`string`, `string`\> |
| `opts.name` | `string` |
| `opts.namespace` | `string` |
| `opts.scope?` | [`WebhookScope`](../../../../../generated/storage/types.gen/type-aliases/WebhookScope.md) |
| `opts.url` | `string` |

#### Returns

`Promise`\<[`Webhook`](../../webhook/classes/Webhook.md)\>

***

### list()

> **list**(): `Promise`\<[`Webhook`](../../webhook/classes/Webhook.md)[]\>

The caller's webhooks across their personal and team workspaces, newest
first. Each returned handle already holds its record.

#### Returns

`Promise`\<[`Webhook`](../../webhook/classes/Webhook.md)[]\>
