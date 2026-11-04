# Type Alias: EventRemindersInput

> **EventRemindersInput** = \{ `overrides?`: [`EventReminderOverrideInput`](EventReminderOverrideInput.md)[]; `useDefault`: `boolean`; \}

Reminder configuration supplied when creating a calendar event.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-overrides"></a> `overrides?` | [`EventReminderOverrideInput`](EventReminderOverrideInput.md)[] | Overrides used when calendar defaults are disabled. |
| <a id="property-usedefault"></a> `useDefault` | `boolean` | Whether the selected calendar's default reminders should apply. |
