# Type Alias: CalendarMutationApiError

> **CalendarMutationApiError** = \{ `code`: [`CalendarMutationErrorCode`](CalendarMutationErrorCode.md); `message`: `string`; \}

HTTP error body returned by calendar mutation endpoints.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-code"></a> `code` | [`CalendarMutationErrorCode`](CalendarMutationErrorCode.md) | Machine-readable failure category. |
| <a id="property-message"></a> `message` | `string` | Human-readable failure description. |
