# Type Alias: CopyThreadCalendarInvitationData

> **CopyThreadCalendarInvitationData** = \{ `body`: [`CopyCalendarEventRequest`](CopyCalendarEventRequest.md); `path`: \{ `invitation_id`: `string`; `message_id`: `string`; `thread_id`: `string`; \}; `query?`: `never`; `url`: `"/email/threads/{thread_id}/messages/{message_id}/calendar-invitations/{invitation_id}/copy"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`CopyCalendarEventRequest`](CopyCalendarEventRequest.md) | - |
| <a id="property-path"></a> `path` | \{ `invitation_id`: `string`; `message_id`: `string`; `thread_id`: `string`; \} | - |
| `path.invitation_id` | `string` | Saved event within the message |
| `path.message_id` | `string` | Message carrying the event |
| `path.thread_id` | `string` | Authorized email thread |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/email/threads/{thread_id}/messages/{message_id}/calendar-invitations/{invitation_id}/copy"` | - |
