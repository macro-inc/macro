# Type Alias: ForwardCalendarEventRequest

> **ForwardCalendarEventRequest** = \{ `bodyText?`: `string` \| `null`; `to`: [`ForwardCalendarEventRecipient`](ForwardCalendarEventRecipient.md)[]; \}

Who a forwarded invitation goes to, and what its email says.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-bodytext"></a> `bodyText?` | `string` \| `null` | A plain-text summary of the event the email opens with; the title when absent. The email ends with a note saying what the recipient can do with the forward. |
| <a id="property-to"></a> `to` | [`ForwardCalendarEventRecipient`](ForwardCalendarEventRecipient.md)[] | The people it goes to, at most 50. |
