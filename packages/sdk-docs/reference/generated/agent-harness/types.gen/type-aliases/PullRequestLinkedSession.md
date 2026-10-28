# Type Alias: PullRequestLinkedSession

> **PullRequestLinkedSession** = \{ `originMessageId?`: `string` \| `null`; `sessionId`: `string`; `source`: [`PullRequestLinkSource`](PullRequestLinkSource.md); `threadParent?`: `null` \| [`MessageParent`](MessageParent.md); \}

A session linked to a pull request, as a viewer of that session sees it.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-originmessageid"></a> `originMessageId?` | `string` \| `null` | The message that started the session, such as an @mention, when it was started from a thread. A mention inside a thread is that reply, not the root. |
| <a id="property-sessionid"></a> `sessionId` | `string` | The session id. |
| <a id="property-source"></a> `source` | [`PullRequestLinkSource`](PullRequestLinkSource.md) | Who associated the pull request with the session. |
| <a id="property-threadparent"></a> `threadParent?` | `null` \| [`MessageParent`](MessageParent.md) | - |
