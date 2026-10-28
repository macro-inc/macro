# Interface: CommentThread

One of a document's comment threads: its state and its comments.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-comments"></a> `comments` | [`Comment`](../../comment/classes/Comment.md)[] | The root comment followed by its replies, in order. |
| <a id="property-thread"></a> `thread` | [`ThreadState`](../../../../../generated/storage/types.gen/type-aliases/ThreadState.md) | The thread state: root id, resolved flag, owner, anchor, timestamps. |
