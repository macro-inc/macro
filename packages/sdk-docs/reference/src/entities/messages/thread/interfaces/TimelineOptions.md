# Interface: TimelineOptions\<TMessage\>

Timeline selection with typed message references and camel case options.

## Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| <a id="type-parameter-tmessage"></a> `TMessage` *extends* [`TimelineMessage`](../type-aliases/TimelineMessage.md) | [`TimelineMessage`](../type-aliases/TimelineMessage.md) |

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-activityafter"></a> `activityAfter?` | `string` | Inclusive activity lower bound. |
| <a id="property-activitybefore"></a> `activityBefore?` | `string` | Exclusive activity upper bound. |
| <a id="property-anchored"></a> `anchored?` | `boolean` | Select anchored threads. |
| <a id="property-around"></a> `around?` | `TMessage` | Fetch around this message. |
| <a id="property-cursor"></a> `cursor?` | [`MessageCursor`](../../../../../generated/storage/types.gen/type-aliases/MessageCursor.md) \| `null` | Opaque continuation cursor from a previous page. |
| <a id="property-direction"></a> `direction?` | [`MessageDirection`](../../../../../generated/storage/types.gen/type-aliases/MessageDirection.md) | Page direction. |
| <a id="property-includedeletedthreads"></a> `includeDeletedThreads?` | `boolean` | Include deleted threads. |
| <a id="property-limit"></a> `limit?` | `number` | Page size. |
| <a id="property-messages"></a> `messages?` | `TMessage`[] | Restrict selection to these messages. |
