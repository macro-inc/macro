# Type Alias: ConversationMetadata

> **ConversationMetadata** = \{ `archived`: `boolean`; `createdAt?`: `null` \| [`SlackTimestamp`](SlackTimestamp.md); `creatorId?`: `null` \| [`SlackUserId`](SlackUserId.md); `folder`: [`KeySegment`](KeySegment.md); `kind`: [`ConversationKind`](ConversationKind.md); `memberIds`: [`SlackUserId`](SlackUserId.md)[]; `messageCount?`: `number` \| `null`; `name`: `string`; `slackChannelId`: [`ConversationId`](ConversationId.md); \}

Full selected conversation metadata, persisted before granting any uploads.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-archived"></a> `archived` | `boolean` | Source archived flag (does not silently archive a reused Macro target). |
| <a id="property-createdat"></a> `createdAt?` | `null` \| [`SlackTimestamp`](SlackTimestamp.md) | - |
| <a id="property-creatorid"></a> `creatorId?` | `null` \| [`SlackUserId`](SlackUserId.md) | - |
| <a id="property-folder"></a> `folder` | [`KeySegment`](KeySegment.md) | Single archive folder name, not a backend object key. |
| <a id="property-kind"></a> `kind` | [`ConversationKind`](ConversationKind.md) | Source conversation kind. |
| <a id="property-memberids"></a> `memberIds` | [`SlackUserId`](SlackUserId.md)[] | Complete source member list, including members unknown to Macro. |
| <a id="property-messagecount"></a> `messageCount?` | `number` \| `null` | Advisory only; null means not yet counted, not zero. |
| <a id="property-name"></a> `name` | `string` | Original display name; not a storage key. |
| <a id="property-slackchannelid"></a> `slackChannelId` | [`ConversationId`](ConversationId.md) | Stable Slack identity. |
