# Type Alias: ForwardCalendarEventRequest

> **ForwardCalendarEventRequest** = \{ `bodyText?`: `string` \| `null`; `to`: [`ForwardCalendarEventRecipient`](ForwardCalendarEventRecipient.md)[]; \}

Who a forwarded invitation goes to, and what its email says.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-bodytext"></a> `bodyText?` | `string` \| `null` | The email's plain-text body. Without one, it names the event and says the recipient won't be on the organizer's guest list. |
| <a id="property-to"></a> `to` | [`ForwardCalendarEventRecipient`](ForwardCalendarEventRecipient.md)[] | The people it goes to, at most 50. |
