# Type Alias: UpdateMeetingRequest

> **UpdateMeetingRequest** = \{ `clearSchedule?`: `boolean`; `scheduledEnd?`: `string` \| `null`; `scheduledStart?`: `string` \| `null`; `title?`: `string` \| `null`; \}

Changes to a meeting's title or scheduled time; omitted values stay unchanged.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-clearschedule"></a> `clearSchedule?` | `boolean` | Remove timed scheduling, for example when the calendar event becomes all-day. |
| <a id="property-scheduledend"></a> `scheduledEnd?` | `string` \| `null` | Replacement scheduled end; requires a matching start. |
| <a id="property-scheduledstart"></a> `scheduledStart?` | `string` \| `null` | Replacement scheduled start; requires a matching end. |
| <a id="property-title"></a> `title?` | `string` \| `null` | Replacement title, when supplied. |
