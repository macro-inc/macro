# Abstract Class: FavoritableEntity\<Detail\>

An entity the favorites API can address, and so can be (un)favorited.

## Extends

- [`MacroEntity`](MacroEntity.md)\<`Detail`\>

## Extended by

- [`CallRecord`](../../calls/call-record/classes/CallRecord.md)
- [`Message`](../../channels/message/classes/Message.md)
- [`Contact`](../../crm/contact/classes/Contact.md)
- [`PropertiedEntity`](PropertiedEntity.md)
- [`ForeignEntity`](../../foreign/foreign-entity/classes/ForeignEntity.md)

## Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-detail"></a> `Detail` |

## Implements

- [`Favoritable`](../interfaces/Favoritable.md)

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-entitytype"></a> `entityType` | `abstract readonly` | `"project"` \| `"user"` \| `"team"` \| `"chat"` \| `"channel"` \| `"channel_message"` \| `"document"` \| `"email_thread"` \| `"calendar_event"` \| `"call"` \| `"foreign_entity"` \| `"static_file"` \| `"crm_company"` \| `"crm_contact"` \| `"crm_pipeline"` \| `"reminder"` \| `"skill"` \| `"agent_session"` \| `"scheduled_action"` \| `"initiative"` \| `"database"` \| `"database_row"` \| `"form"` | How the entity-addressed APIs (favorites) identify this entity's type. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](MacroEntity.md).[`id`](MacroEntity.md#property-id) |

## Methods

### favorite()

> **favorite**(): `Promise`\<`FavoritableEntity`\<`Detail`\>\>

Add this entity to the user's favorites. Returns this handle for chaining.
Plain unwrap: favoriting alters the user's favorites collection, not this
entity's own detail, so there's nothing cached to invalidate.

#### Returns

`Promise`\<`FavoritableEntity`\<`Detail`\>\>

#### Implementation of

[`Favoritable`](../interfaces/Favoritable.md).[`favorite`](../interfaces/Favoritable.md#favorite)

***

### permission()

> **permission**(): `Promise`\<\{ `permission`: [`EntityPermission`](../../../../generated/storage/types.gen/type-aliases/EntityPermission.md); `status`: `"access"`; \} \| \{ `status`: `"no_access"`; \}\>

Read the caller's effective permission on this entity.

#### Returns

`Promise`\<\{ `permission`: [`EntityPermission`](../../../../generated/storage/types.gen/type-aliases/EntityPermission.md); `status`: `"access"`; \} \| \{ `status`: `"no_access"`; \}\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: `Detail`; `id`: `string`; \}

#### Returns

\{ `detail?`: `Detail`; `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | `Detail` |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](MacroEntity.md).[`toJSON`](MacroEntity.md#tojson)

***

### unfavorite()

> **unfavorite**(): `Promise`\<`FavoritableEntity`\<`Detail`\>\>

Remove this entity from the user's favorites. Returns this handle for chaining.

#### Returns

`Promise`\<`FavoritableEntity`\<`Detail`\>\>

#### Implementation of

[`Favoritable`](../interfaces/Favoritable.md).[`unfavorite`](../interfaces/Favoritable.md#unfavorite)
