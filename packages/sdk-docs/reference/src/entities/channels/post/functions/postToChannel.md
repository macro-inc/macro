# Function: postToChannel()

> **postToChannel**(`client`, `target`, `body`, `images?`): `Promise`\<`string`\>

Post a message using the endpoint supported by the caller's credentials.

Most credentials use `POST /messages/channel/{id}`. User-owned bots without
an acting user instead use `POST /channels/{id}/webhook`, which authorizes
through channel membership. The bot owner is read from `GET /bots/me` and
cached by the client.

The webhook endpoint supports content only. Mentions in `<m-*>` tags still
work, but threads and images are not supported.

Posting to a `Thread` puts the message in that thread; to a `Channel`, at the
channel root. One target rather than a channel plus a thread id, so the two
can't disagree.

## Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `client` | `MacroClient` | `undefined` |
| `target` | [`Channel`](../../channel/classes/Channel.md) \| [`Thread`](../../thread/classes/Thread.md) | `undefined` |
| `body` | [`RichMessage`](../../../../mentions/interfaces/RichMessage.md) | `undefined` |
| `images?` | [`StaticImage`](../../../images/image/classes/StaticImage.md)[] | `[]` |

## Returns

`Promise`\<`string`\>
