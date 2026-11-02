# Type Alias: CalendarSuggestions

> **CalendarSuggestions** = \{ `body?`: `string` \| `null`; `end?`: `string` \| `null`; `guests?`: `string`[]; `location?`: `string` \| `null`; `recurrence?`: `null` \| [`RecurrenceSuggestion`](RecurrenceSuggestion.md); `start?`: `string` \| `null`; `start_assumption?`: `string` \| `null`; `title?`: `string` \| `null`; \}

Editable fields for calendar inference, before submission and identity resolution.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `string` \| `null` | Suggested Markdown content or outgoing message body. |
| <a id="property-end"></a> `end?` | `string` \| `null` | Event end as a local wall-clock value in the request's timezone. |
| <a id="property-guests"></a> `guests?` | `string`[] | Only populated when an invitation was explicitly requested. |
| <a id="property-location"></a> `location?` | `string` \| `null` | Human-readable event venue or meeting URL. |
| <a id="property-recurrence"></a> `recurrence?` | `null` \| [`RecurrenceSuggestion`](RecurrenceSuggestion.md) | - |
| <a id="property-start"></a> `start?` | `string` \| `null` | Local wall-clock values, interpreted in the request's IANA timezone. |
| <a id="property-start_assumption"></a> `start_assumption?` | `string` \| `null` | Verbatim clock phrase whose missing AM/PM required an editable assumption. |
| <a id="property-title"></a> `title?` | `string` \| `null` | Suggested note, task, or event title. |
