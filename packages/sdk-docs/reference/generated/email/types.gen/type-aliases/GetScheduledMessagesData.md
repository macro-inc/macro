# Type Alias: GetScheduledMessagesData

> **GetScheduledMessagesData** = \{ `body?`: `never`; `path?`: `never`; `query?`: \{ `limit?`: `number`; `offset?`: `number`; `source?`: `null` \| [`ScheduledSendSource`](ScheduledSendSource.md); \}; `url`: `"/email/drafts/scheduled"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path?` | `never` | - |
| <a id="property-query"></a> `query?` | \{ `limit?`: `number`; `offset?`: `number`; `source?`: `null` \| [`ScheduledSendSource`](ScheduledSendSource.md); \} | - |
| `query.limit?` | `number` | The maximum number of scheduled messages to return. |
| `query.offset?` | `number` | The number of scheduled messages to skip. |
| `query.source?` | `null` \| [`ScheduledSendSource`](ScheduledSendSource.md) | List only the sends this source created, in every delivery state. Without it, the user's own scheduled sends are listed: pending sequence steps are hidden, like in Drafts, and failed ones are included. |
| <a id="property-url"></a> `url` | `"/email/drafts/scheduled"` | - |
