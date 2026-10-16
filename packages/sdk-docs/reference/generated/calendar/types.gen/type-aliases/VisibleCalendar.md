# Type Alias: VisibleCalendar

> **VisibleCalendar** = \{ `color?`: `string` \| `null`; `defaultReminders`: [`EventReminderOverride`](EventReminderOverride.md)[]; `emailAddress`: `string`; `emailLinkId`: `string`; `id`: `string`; `isPrimary`: `boolean`; `isSubscription`: `boolean`; `isWritable`: `boolean`; `name`: `string`; `syncError?`: `string` \| `null`; \}

A calendar visible to a requester, listed for pickers and filters.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-color"></a> `color?` | `string` \| `null` | Provider color. |
| <a id="property-defaultreminders"></a> `defaultReminders` | [`EventReminderOverride`](EventReminderOverride.md)[] | Default reminders applied to events that keep `useDefault`. |
| <a id="property-emailaddress"></a> `emailAddress` | `string` | Connected inbox address, for grouping in multi-inbox pickers. |
| <a id="property-emaillinkid"></a> `emailLinkId` | `string` | Connected inbox that syncs this calendar. |
| <a id="property-id"></a> `id` | `string` | Persisted Macro calendar identifier. |
| <a id="property-isprimary"></a> `isPrimary` | `boolean` | Whether this is its account's primary calendar. |
| <a id="property-issubscription"></a> `isSubscription` | `boolean` | Whether this is one of Google's shared system calendars (holidays, birthdays) the account subscribes to rather than one a person maintains. |
| <a id="property-iswritable"></a> `isWritable` | `boolean` | Whether the grant can create and modify events on this calendar. |
| <a id="property-name"></a> `name` | `string` | Provider display name. |
| <a id="property-syncerror"></a> `syncError?` | `string` \| `null` | A persistent sync failure isolated to this calendar, surfaced so the settings row can badge it. `None` while the calendar is syncing normally or a failure has not yet crossed the persistence threshold. |
