# Type Alias: ListEmailRemindersData

> **ListEmailRemindersData** = \{ `body?`: `never`; `path?`: `never`; `query?`: \{ `attachments?`: `string`[] \| `null`; `calendar?`: `boolean` \| `null`; `cursor?`: `string` \| `null`; `done?`: `boolean` \| `null`; `inboxIds?`: `string`[] \| `null`; `limit?`: `number` \| `null`; `noInboxes?`: `boolean` \| `null`; `read?`: `boolean` \| `null`; `tags?`: `string`[] \| `null`; \}; `url`: `"/reminders/email/collection"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path?` | `never` | - |
| <a id="property-query"></a> `query?` | \{ `attachments?`: `string`[] \| `null`; `calendar?`: `boolean` \| `null`; `cursor?`: `string` \| `null`; `done?`: `boolean` \| `null`; `inboxIds?`: `string`[] \| `null`; `limit?`: `number` \| `null`; `noInboxes?`: `boolean` \| `null`; `read?`: `boolean` \| `null`; `tags?`: `string`[] \| `null`; \} | - |
| `query.attachments?` | `string`[] \| `null` | Repeated attachment categories: pdf, image, document. |
| `query.calendar?` | `boolean` \| `null` | Restrict to calendar mail. |
| `query.cursor?` | `string` \| `null` | Continuation from the previous page. |
| `query.done?` | `boolean` \| `null` | Email archive filter, independent of reminder completion. |
| `query.inboxIds?` | `string`[] \| `null` | Selected inboxes; omission selects all accessible inboxes. |
| `query.limit?` | `number` \| `null` | Maximum rows (1–100). |
| `query.noInboxes?` | `boolean` \| `null` | Explicitly empty inbox selection. |
| `query.read?` | `boolean` \| `null` | Email read status. |
| `query.tags?` | `string`[] \| `null` | Repeated property-definition:select-option UUID pairs. |
| <a id="property-url"></a> `url` | `"/reminders/email/collection"` | - |
