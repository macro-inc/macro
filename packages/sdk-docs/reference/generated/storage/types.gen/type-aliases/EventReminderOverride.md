# Type Alias: EventReminderOverride

> **EventReminderOverride** = \{ `method`: `string`; `minutes`: `number`; \}

One reminder: how it alerts and how many minutes before the event start
(before midnight in the calendar's zone for all-day events) it fires.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-method"></a> `method` | `string` | Provider method, stored verbatim; only `popup` fires Macro notifications. |
| <a id="property-minutes"></a> `minutes` | `number` | Minutes before the event start. |
