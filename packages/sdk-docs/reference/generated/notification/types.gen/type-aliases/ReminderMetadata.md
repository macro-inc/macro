# Type Alias: ReminderMetadata

> **ReminderMetadata** = \{ `channelId?`: `string` \| `null`; `description`: `string`; `messageId?`: `string` \| `null`; `reminderId`: `string`; `scheduledFor?`: `string` \| `null`; `threadId?`: `string` \| `null`; \}

Metadata for a reminder the user set for themselves coming due.

There is no sender: a reminder is self-set, so the dispatcher sends it with
`sender_id: None` (a recipient who is also the sender is filtered out of
their own notification). Every formatter here must therefore work without
one.

The associated entity, when there is one, lives on the notification row
rather than in here, and clients resolve its name from that — so the
dispatcher does not have to look up a name across five entity types.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-channelid"></a> `channelId?` | `string` \| `null` | Channel a message reminder opens. Absent for email snoozes. |
| <a id="property-description"></a> `description` | `string` | What the user asked to be reminded about. |
| <a id="property-messageid"></a> `messageId?` | `string` \| `null` | Channel message a message reminder opens. Absent for email snoozes. |
| <a id="property-reminderid"></a> `reminderId` | `string` | The reminder that fired. |
| <a id="property-scheduledfor"></a> `scheduledFor?` | `string` \| `null` | Which firing this is — the occurrence the reminder came due for. What distinguishes two firings of the same recurring reminder, which are otherwise identical: same id, same description. The collapse key is built from it, so without it Tuesday's alert would replace Monday's unread one on the lock screen. Optional because notifications written before recurring dispatch existed have no such field, and they still have to read back. |
| <a id="property-threadid"></a> `threadId?` | `string` \| `null` | Thread root when the reminded message is a reply. |
