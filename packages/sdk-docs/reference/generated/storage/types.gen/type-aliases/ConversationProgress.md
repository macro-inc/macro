# Type Alias: ConversationProgress

> **ConversationProgress** = \{ `archived`: `boolean`; `channelId?`: `string` \| `null`; `counters`: [`ImportCounters`](ImportCounters.md); `error?`: `null` \| [`ImportError`](ImportError.md); `kind`: [`ConversationKind`](ConversationKind.md); `name`: `string`; `partCount?`: `number` \| `null`; `search`: [`SearchState`](SearchState.md); `slackChannelId`: [`ConversationId`](ConversationId.md); `status`: [`ConversationStatus`](ConversationStatus.md); `verifiedParts`: `number`; `warnings`: [`ImportWarning`](ImportWarning.md)[]; \}

Admin-visible progress for one selected conversation.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-archived"></a> `archived` | `boolean` | Whether the selected source conversation was archived. |
| <a id="property-channelid"></a> `channelId?` | `string` \| `null` | Authorized target only; absent for inaccessible reused targets. |
| <a id="property-counters"></a> `counters` | [`ImportCounters`](ImportCounters.md) | Durably committed record counts. |
| <a id="property-error"></a> `error?` | `null` \| [`ImportError`](ImportError.md) | - |
| <a id="property-kind"></a> `kind` | [`ConversationKind`](ConversationKind.md) | Persisted source kind. |
| <a id="property-name"></a> `name` | `string` | Persisted source display name, never the reused Macro target's name. |
| <a id="property-partcount"></a> `partCount?` | `number` \| `null` | Null until sealed; zero is a valid sealed empty manifest. |
| <a id="property-search"></a> `search` | [`SearchState`](SearchState.md) | Independent indexing state. |
| <a id="property-slackchannelid"></a> `slackChannelId` | [`ConversationId`](ConversationId.md) | Source identity (always visible to the importing team's administrator). |
| <a id="property-status"></a> `status` | [`ConversationStatus`](ConversationStatus.md) | Durable state. |
| <a id="property-verifiedparts"></a> `verifiedParts` | `number` | Number of parts whose object identity has been verified. |
| <a id="property-warnings"></a> `warnings` | [`ImportWarning`](ImportWarning.md)[] | Non-fatal metadata/skip explanations. |
