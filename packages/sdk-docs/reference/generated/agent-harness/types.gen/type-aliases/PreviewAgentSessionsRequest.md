# Type Alias: PreviewAgentSessionsRequest

> **PreviewAgentSessionsRequest** = \{ `sessionIds`: `string`[]; \}

Request body for `POST /agent-sessions/preview`.

Clients serialize this, so both derives are used.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-sessionids"></a> `sessionIds` | `string`[] | The sessions to preview. Duplicates are collapsed server-side; at most [`MAX_PREVIEW_SESSION_IDS`](crate::domain::model::MAX_PREVIEW_SESSION_IDS) distinct ids per request. |
