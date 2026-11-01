# Class: Notification

A notification in the viewer's feed.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<`NotificationDetail`\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-createdat"></a> `createdAt` | `readonly` | () => `Promise`\<`string`\> | When the notification was created. | - |
| <a id="property-deletedat"></a> `deletedAt` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | When the notification was deleted, if it has been. | - |
| <a id="property-done"></a> `done` | `readonly` | () => `Promise`\<`boolean`\> | Whether the notification is completed. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-metadata"></a> `metadata` | `readonly` | () => `Promise`\<[`NotifEvent`](../../../../../generated/notification/types.gen/type-aliases/NotifEvent.md)\> | The typed notification payload (tagged by event type). | - |
| <a id="property-owner"></a> `owner` | `readonly` | () => `Promise`\<[`User`](../../../users/user/classes/User.md)\> | The user who owns (receives) this notification. | - |
| <a id="property-sender"></a> `sender` | `readonly` | () => `Promise`\<[`User`](../../../users/user/classes/User.md) \| `undefined`\> | The user who triggered the notification, if any. | - |
| <a id="property-sent"></a> `sent` | `readonly` | () => `Promise`\<`boolean`\> | Whether the notification has been sent (delivered out of band). | - |
| <a id="property-state"></a> `state` | `readonly` | () => `Promise`\<[`NotificationState`](../../../../../generated/notification/types.gen/type-aliases/NotificationState.md)\> | The authoritative lifecycle state, independent of viewing timestamps. | - |
| <a id="property-type"></a> `type` | `readonly` | () => `Promise`\<`string`\> | The notification event type (e.g. `channel_mention`). | - |
| <a id="property-updatedat"></a> `updatedAt` | `readonly` | () => `Promise`\<`string`\> | When the notification was last updated. | - |
| <a id="property-viewedat"></a> `viewedAt` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | When the notification was viewed, if it has been seen. | - |

## Methods

### delete()

> **delete**(): `Promise`\<`void`\>

Delete the notification.

#### Returns

`Promise`\<`void`\>

***

### markDone()

> **markDone**(): `Promise`\<`void`\>

Mark the notification as done.

#### Returns

`Promise`\<`void`\>

***

### markSeen()

> **markSeen**(): `Promise`\<`void`\>

Mark the notification as seen.

#### Returns

`Promise`\<`void`\>

***

### markUndone()

> **markUndone**(): `Promise`\<`void`\>

Move the notification back to not-done.

#### Returns

`Promise`\<`void`\>

***

### seen()

> **seen**(): `Promise`\<`boolean`\>

Whether the notification is acknowledged (seen or done).

#### Returns

`Promise`\<`boolean`\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`ApiUserNotification`](../../../../../generated/notification/types.gen/type-aliases/ApiUserNotification.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`ApiUserNotification`](../../../../../generated/notification/types.gen/type-aliases/ApiUserNotification.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`ApiUserNotification`](../../../../../generated/notification/types.gen/type-aliases/ApiUserNotification.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### byId()

> `static` **byId**(`client`, `id`): `Notification`

A handle to a notification by id. Details load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`Notification`

***

### from()

> `static` **from**(`client`, `data`): `Notification`

Build a notification from a list-endpoint record (pre-seeded, no fetch).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `data` | [`ApiUserNotification`](../../../../../generated/notification/types.gen/type-aliases/ApiUserNotification.md) |

#### Returns

`Notification`

***

### list()

> `static` **list**(`client`, `opts?`): `AsyncGenerator`\<`Notification`\>

The viewer's notification feed, most recent first, auto-paginated.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `opts?` | \{ `pageSize?`: `number`; `states?`: [`NotificationState`](../../../../../generated/notification/types.gen/type-aliases/NotificationState.md)[]; \} |
| `opts.pageSize?` | `number` |
| `opts.states?` | [`NotificationState`](../../../../../generated/notification/types.gen/type-aliases/NotificationState.md)[] |

#### Returns

`AsyncGenerator`\<`Notification`\>
