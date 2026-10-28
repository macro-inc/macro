# Type Alias: PrepareCalendarReplacementRequest

> **PrepareCalendarReplacementRequest** = \{ `calendarId?`: `string` \| `null`; `recurrenceId?`: `string` \| `null`; `removeConference`: `boolean`; \}

A read-only preview request. Confirmation uses the returned operation identity.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-calendarid"></a> `calendarId?` | `string` \| `null` | Exact calendar copy; defaults to canonical. |
| <a id="property-recurrenceid"></a> `recurrenceId?` | `string` \| `null` | Original-start key; omitted to replace the entire series. |
| <a id="property-removeconference"></a> `removeConference` | `boolean` | Omit the provider conference in the replacement. |
