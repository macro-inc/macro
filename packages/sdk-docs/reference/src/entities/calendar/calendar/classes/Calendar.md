# Class: Calendar

A calendar visible to the requester across their connected inboxes: a
free-to-construct handle whose detail resolves from the caller's calendar
list. There is no fetch-by-id endpoint, so a bare [Calendar.byId](#byid)
handle loads its detail by listing the caller's calendars and matching on id.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`VisibleCalendar`](../../../../../generated/calendar/types.gen/type-aliases/VisibleCalendar.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-color"></a> `color` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | Provider color, when set. | - |
| <a id="property-contributestoavailability"></a> `contributesToAvailability` | `readonly` | () => `Promise`\<`NonNullable`\<`boolean` \| `undefined`\> \| `undefined`\> | Whether this calendar counts toward the caller's busy time: their setting, by default only the primary calendars of inboxes they own. | - |
| <a id="property-emailaddress"></a> `emailAddress` | `readonly` | () => `Promise`\<`string`\> | Connected inbox address that syncs this calendar. It stays the user's own address on a calendar someone else shared with them. | - |
| <a id="property-emaillink"></a> `emailLink` | `readonly` | () => `Promise`\<[`Link`](../../../email/link/classes/Link.md)\> | The connected inbox (email link) that syncs this calendar. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-isprimary"></a> `isPrimary` | `readonly` | () => `Promise`\<`boolean`\> | Whether this is its account's primary calendar. The user's other calendars are not primary either, so false does not mean it isn't theirs. | - |
| <a id="property-issubscription"></a> `isSubscription` | `readonly` | () => `Promise`\<`boolean`\> | Whether this is a subscribed system calendar (holidays, birthdays). | - |
| <a id="property-iswritable"></a> `isWritable` | `readonly` | () => `Promise`\<`boolean`\> | Whether the grant can create and modify events on this calendar. People can hold that on someone else's calendar, so it does not mean it is theirs. | - |
| <a id="property-name"></a> `name` | `readonly` | () => `Promise`\<`string`\> | Provider display name. Often says whose calendar it is: Google names a person's primary calendar after them or their address. | - |
| <a id="property-syncerror"></a> `syncError` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | A persistent per-calendar sync failure, surfaced for settings badges. | - |

## Methods

### setContributesToAvailability()

> **setContributesToAvailability**(`contributesToAvailability`): `Promise`\<`void`\>

Set whether this calendar contributes to the caller's availability.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `contributesToAvailability` | `boolean` |

#### Returns

`Promise`\<`void`\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`VisibleCalendar`](../../../../../generated/calendar/types.gen/type-aliases/VisibleCalendar.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`VisibleCalendar`](../../../../../generated/calendar/types.gen/type-aliases/VisibleCalendar.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`VisibleCalendar`](../../../../../generated/calendar/types.gen/type-aliases/VisibleCalendar.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### byId()

> `static` **byId**(`client`, `id`): `Calendar`

A handle to a calendar by id. Detail loads on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`Calendar`

***

### list()

> `static` **list**(`client`): `Promise`\<`Calendar`[]\>

The caller's visible calendars, primaries and writable first.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`Promise`\<`Calendar`[]\>
