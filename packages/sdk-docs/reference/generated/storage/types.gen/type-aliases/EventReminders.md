# Type Alias: EventReminders

> **EventReminders** = \{ `overrides?`: [`EventReminderOverride`](EventReminderOverride.md)[]; `useDefault`: `boolean`; \}

Per-user reminder configuration for an event, mirroring Google's model:
either the calendar's default reminders apply, or the explicit overrides
replace them entirely.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-overrides"></a> `overrides?` | [`EventReminderOverride`](EventReminderOverride.md)[] | Explicit reminders replacing the defaults when `use_default` is off. |
| <a id="property-usedefault"></a> `useDefault` | `boolean` | Whether the calendar's default reminders apply. |
