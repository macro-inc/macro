# Interface: CrmCommentThread

One of a CRM record's comment threads: its state and its comments.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-comments"></a> `comments` | [`CrmComment`](../classes/CrmComment.md)[] | The thread's comments, root first, then replies oldest first. |
| <a id="property-thread"></a> `thread` | [`ThreadState`](../../../../../generated/storage/types.gen/type-aliases/ThreadState.md) | The thread state: root id, resolved flag, owner, timestamps. |
