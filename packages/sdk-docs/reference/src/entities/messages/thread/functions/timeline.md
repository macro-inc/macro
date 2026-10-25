# Function: timeline()

> **timeline**\<`TMessage`\>(`client`, `parent`, `map`, `selection?`): `Promise`\<\{ `entries`: (\{ `activity`: \{ `action`: `string`; `actor`: [`User`](../../../users/user/classes/User.md); `actor_id`: `string`; `id`: `string`; `occurred_at`: `string`; `payload?`: `unknown`; \}; `message?`: `undefined`; `type`: `"activity"`; \} \| \{ `activity?`: `undefined`; `message`: `TMessage`; `type`: `"message"`; \})[]; `nextCursor`: [`MessageCursor`](../../../../../generated/storage/types.gen/type-aliases/MessageCursor.md) \| `undefined`; `previousCursor`: [`MessageCursor`](../../../../../generated/storage/types.gen/type-aliases/MessageCursor.md) \| `undefined`; \}\>

A bounded mixed message/activity page with typed message handles.

## Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-tmessage"></a> `TMessage` *extends* [`TimelineMessage`](../type-aliases/TimelineMessage.md) |

## Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `parent` | [`MessageParent`](../type-aliases/MessageParent.md) |
| `map` | (`record`) => `TMessage` |
| `selection?` | [`TimelineOptions`](../interfaces/TimelineOptions.md)\<`TMessage`\> |

## Returns

`Promise`\<\{ `entries`: (\{ `activity`: \{ `action`: `string`; `actor`: [`User`](../../../users/user/classes/User.md); `actor_id`: `string`; `id`: `string`; `occurred_at`: `string`; `payload?`: `unknown`; \}; `message?`: `undefined`; `type`: `"activity"`; \} \| \{ `activity?`: `undefined`; `message`: `TMessage`; `type`: `"message"`; \})[]; `nextCursor`: [`MessageCursor`](../../../../../generated/storage/types.gen/type-aliases/MessageCursor.md) \| `undefined`; `previousCursor`: [`MessageCursor`](../../../../../generated/storage/types.gen/type-aliases/MessageCursor.md) \| `undefined`; \}\>
