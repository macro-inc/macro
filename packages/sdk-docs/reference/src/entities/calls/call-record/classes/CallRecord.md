# Class: CallRecord

A Macro call record (an archived or still active call).

## Extends

- [`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md)\<`CallRecordDetail`\>

## Properties

| Property | Modifier | Type | Default value | Description | Overrides | Inherited from |
| ------ | ------ | ------ | ------ | ------ | ------ | ------ |
| <a id="property-channel"></a> `channel` | `readonly` | () => `Promise`\<[`Channel`](../../../channels/channel/classes/Channel.md) \| `undefined`\> | `...` | The channel the call belongs to, if it is a channel call. | - | - |
| <a id="property-channelname"></a> `channelName` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | `...` | The display name of the channel the call belongs to. | - | - |
| <a id="property-creator"></a> `creator` | `readonly` | () => `Promise`\<[`User`](../../../users/user/classes/User.md)\> | `...` | The user who started the call. | - | - |
| <a id="property-durationms"></a> `durationMs` | `readonly` | () => `Promise`\<`number` \| `undefined`\> | `...` | Call duration in milliseconds (undefined if still active). | - | - |
| <a id="property-endedat"></a> `endedAt` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | `...` | When the call ended (undefined if still active). | - | - |
| <a id="property-entitytype"></a> `entityType` | `readonly` | `"call"` | `'call'` | Favorites identify call records as `call`. | [`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md).[`entityType`](../../../entity/classes/FavoritableEntity.md#property-entitytype) | - |
| <a id="property-guests"></a> `guests` | `readonly` | () => `Promise`\<[`CallRecordGuest`](../../../../../generated/storage/types.gen/type-aliases/CallRecordGuest.md)[]\> | `...` | Current and past guests; each id matches its transcript speaker id. | - | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | `undefined` | - | - | [`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md).[`id`](../../../entity/classes/FavoritableEntity.md#property-id) |
| <a id="property-isactive"></a> `isActive` | `readonly` | () => `Promise`\<`boolean`\> | `...` | Whether the call is still in progress. | - | - |
| <a id="property-name"></a> `name` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | `...` | The call's display name (user-supplied or AI-generated; unset while active). | - | - |
| <a id="property-participants"></a> `participants` | `readonly` | () => `Promise`\<[`CallRecordParticipant`](../../../../../generated/storage/types.gen/type-aliases/CallRecordParticipant.md)[]\> | `...` | Macro-account participants, both active and historic. | - | - |
| <a id="property-recordingpreviewurl"></a> `recordingPreviewUrl` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | `...` | URL of the recording preview (thumbnail), once available. | - | - |
| <a id="property-recordingstartedat"></a> `recordingStartedAt` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | `...` | When the recording started, if it was recorded. | - | - |
| <a id="property-recordingurl"></a> `recordingUrl` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | `...` | URL of the call recording, once available. | - | - |
| <a id="property-roomname"></a> `roomName` | `readonly` | () => `Promise`\<`string`\> | `...` | The realtime room the call runs in. | - | - |
| <a id="property-sharewithteam"></a> `shareWithTeam` | `readonly` | () => `Promise`\<`boolean`\> | `...` | Whether the call is shared with the creator's team: the pending toggle while the call is live, the canonical grant once it is archived. | - | - |
| <a id="property-startedat"></a> `startedAt` | `readonly` | () => `Promise`\<`string`\> | `...` | When the call started. | - | - |
| <a id="property-status"></a> `status` | `readonly` | () => `Promise`\<`NonNullable`\<CallStatus \| null \| undefined\> \| `undefined`\> | `...` | The call's status (undefined until set). | - | - |
| <a id="property-summary"></a> `summary` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | `...` | AI-generated summary of the call, once summarization has run. | - | - |
| <a id="property-teamshareaccesslevel"></a> `teamShareAccessLevel` | `readonly` | () => `Promise`\<`NonNullable`\<AccessLevel \| null \| undefined\> \| `undefined`\> | `...` | The canonical access level granted to the creator's team once the call is archived, or null when it is not shared. Calls only ever grant `'view'`; while the call is live this is null and [CallRecord.shareWithTeam](#property-sharewithteam) carries the pending toggle. | - | - |
| <a id="property-transcript"></a> `transcript` | `readonly` | () => `Promise`\<[`CallRecordTranscriptSegment`](../../../../../generated/storage/types.gen/type-aliases/CallRecordTranscriptSegment.md)[]\> | `...` | Transcript segments, ordered by sequence number. | - | - |
| <a id="property-search"></a> `search` | `static` | (`client`, `query`, `searchOpts?`) => `AsyncGenerator`\<`CallRecord`\> | `...` | Search calls by name and transcript, most relevant first, auto-paginated. | - | - |

## Methods

### delete()

> **delete**(): `Promise`\<`void`\>

Delete the call record.

#### Returns

`Promise`\<`void`\>

***

### favorite()

> **favorite**(): `Promise`\<`CallRecord`\>

Add this entity to the user's favorites. Returns this handle for chaining.
Plain unwrap: favoriting alters the user's favorites collection, not this
entity's own detail, so there's nothing cached to invalidate.

#### Returns

`Promise`\<`CallRecord`\>

#### Inherited from

[`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md).[`favorite`](../../../entity/classes/FavoritableEntity.md#favorite)

***

### message()

> **message**(`id`): [`CallMessage`](../../message/classes/CallMessage.md)

A message in this call's persistent chat. Fields load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`CallMessage`](../../message/classes/CallMessage.md)

***

### rename()

> **rename**(`name`): `Promise`\<`void`\>

Rename the call or clear the custom name.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` \| `null` |

#### Returns

`Promise`\<`void`\>

***

### setTeamShare()

> **setTeamShare**(`shared`): `Promise`\<`void`\>

Share the call with the creator's team (view access), or unshare it.
While the call is live this sets the pending toggle any participant with
edit access may change; once archived only the call's creator may change
it and the API answers 403 otherwise.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `shared` | `boolean` |

#### Returns

`Promise`\<`void`\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`CallRecord`](../../../../../generated/storage/types.gen/type-aliases/CallRecord.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`CallRecord`](../../../../../generated/storage/types.gen/type-aliases/CallRecord.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`CallRecord`](../../../../../generated/storage/types.gen/type-aliases/CallRecord.md) |
| `id` | `string` |

#### Inherited from

[`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md).[`toJSON`](../../../entity/classes/FavoritableEntity.md#tojson)

***

### unfavorite()

> **unfavorite**(): `Promise`\<`CallRecord`\>

Remove this entity from the user's favorites. Returns this handle for chaining.

#### Returns

`Promise`\<`CallRecord`\>

#### Inherited from

[`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md).[`unfavorite`](../../../entity/classes/FavoritableEntity.md#unfavorite)

***

### byId()

> `static` **byId**(`client`, `id`): `CallRecord`

A handle to a call record by id. Details load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`CallRecord`
