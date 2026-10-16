# Class: ChannelLabelsNamespace

Shared or private channel labels: named groups of channels shown in the Chat
sidebar. Every member of the team sees the same labels in the same order,
and any member may create, rename, delete, or move channels between them;
each change applies to the whole team. Users without a team have private
labels belonging to their account.

A label's `channelIds` lists only the channels the authenticated user is a
member of. Manual labels count all assignments; smart tags count visible
matches. A channel can be in one manual label and any number of matching
smart tags per team or account. Direct messages cannot be grouped.

## Constructors

### Constructor

> **new ChannelLabelsNamespace**(`client`): `ChannelLabelsNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`ChannelLabelsNamespace`

## Methods

### create()

> **create**(`name`, `channels?`): `Promise`\<[`ChannelLabel`](../../../../../generated/storage/types.gen/type-aliases/ChannelLabel.md)\>

Create a label and atomically move `channels` into it. Names are unique
within the team or account, case-insensitively.

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `name` | `string` | `undefined` |
| `channels?` | [`Channel`](../../channel/classes/Channel.md)[] | `[]` |

#### Returns

`Promise`\<[`ChannelLabel`](../../../../../generated/storage/types.gen/type-aliases/ChannelLabel.md)\>

***

### createSmartTag()

> **createSmartTag**(`name`, `rule`): `Promise`\<[`ChannelLabel`](../../../../../generated/storage/types.gen/type-aliases/ChannelLabel.md)\>

Create a smart tag whose membership follows an attribute rule automatically.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |
| `rule` | [`ChannelLabelRule`](../../../../../generated/storage/types.gen/type-aliases/ChannelLabelRule.md) |

#### Returns

`Promise`\<[`ChannelLabel`](../../../../../generated/storage/types.gen/type-aliases/ChannelLabel.md)\>

***

### delete()

> **delete**(`label`): `Promise`\<`void`\>

Delete a label for the whole team; its channels return to the plain list.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `label` | [`ChannelLabel`](../../../../../generated/storage/types.gen/type-aliases/ChannelLabel.md) |

#### Returns

`Promise`\<`void`\>

***

### list()

> **list**(): `Promise`\<[`ChannelLabel`](../../../../../generated/storage/types.gen/type-aliases/ChannelLabel.md)[]\>

Every label in the authenticated user's shared or private scope.

#### Returns

`Promise`\<[`ChannelLabel`](../../../../../generated/storage/types.gen/type-aliases/ChannelLabel.md)[]\>

***

### previewSmartTag()

> **previewSmartTag**(`rule`): `Promise`\<[`SmartTagPreview`](../../../../../generated/storage/types.gen/type-aliases/SmartTagPreview.md)\>

Preview the first matches and total visible count without creating a tag.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `rule` | [`ChannelLabelRule`](../../../../../generated/storage/types.gen/type-aliases/ChannelLabelRule.md) |

#### Returns

`Promise`\<[`SmartTagPreview`](../../../../../generated/storage/types.gen/type-aliases/SmartTagPreview.md)\>

***

### rename()

> **rename**(`label`, `name`): `Promise`\<[`ChannelLabel`](../../../../../generated/storage/types.gen/type-aliases/ChannelLabel.md)\>

Rename a label for the whole team.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `label` | [`ChannelLabel`](../../../../../generated/storage/types.gen/type-aliases/ChannelLabel.md) |
| `name` | `string` |

#### Returns

`Promise`\<[`ChannelLabel`](../../../../../generated/storage/types.gen/type-aliases/ChannelLabel.md)\>

***

### setLabel()

> **setLabel**(`channel`, `label`): `Promise`\<`void`\>

Move a channel into `label`, or out of any label when `label` is `undefined`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `channel` | [`Channel`](../../channel/classes/Channel.md) |
| `label` | [`ChannelLabel`](../../../../../generated/storage/types.gen/type-aliases/ChannelLabel.md) \| `undefined` |

#### Returns

`Promise`\<`void`\>

***

### updateSmartTag()

> **updateSmartTag**(`label`, `name`, `rule`): `Promise`\<[`ChannelLabel`](../../../../../generated/storage/types.gen/type-aliases/ChannelLabel.md)\>

Update the name and matching rule of an existing smart tag.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `label` | [`ChannelLabel`](../../../../../generated/storage/types.gen/type-aliases/ChannelLabel.md) |
| `name` | `string` |
| `rule` | [`ChannelLabelRule`](../../../../../generated/storage/types.gen/type-aliases/ChannelLabelRule.md) |

#### Returns

`Promise`\<[`ChannelLabel`](../../../../../generated/storage/types.gen/type-aliases/ChannelLabel.md)\>
