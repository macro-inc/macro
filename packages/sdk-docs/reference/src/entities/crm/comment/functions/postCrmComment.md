# Function: postCrmComment()

> **postCrmComment**(`client`, `parent`, `body`, `opts?`): `Promise`\<[`CrmComment`](../classes/CrmComment.md)\>

Post a comment on a CRM record: a new thread, or a reply when `threadId`
(the thread's root comment id) is given.

## Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `parent` | [`CrmCommentParent`](../interfaces/CrmCommentParent.md) |
| `body` | `string` \| [`RichMessage`](../../../../mentions/interfaces/RichMessage.md) |
| `opts?` | \{ `threadId?`: `string`; \} |
| `opts.threadId?` | `string` |

## Returns

`Promise`\<[`CrmComment`](../classes/CrmComment.md)\>
