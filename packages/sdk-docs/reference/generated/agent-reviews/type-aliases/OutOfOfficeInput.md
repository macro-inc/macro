# Type Alias: OutOfOfficeInput

> **OutOfOfficeInput** = \{ `autoDeclineMode?`: [`AutoDeclineModeInput`](AutoDeclineModeInput.md) \| `null`; `declineMessage?`: `string` \| `null`; \}

Out-of-office decline behavior supplied to the calendar tools.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-autodeclinemode"></a> `autoDeclineMode?` | [`AutoDeclineModeInput`](AutoDeclineModeInput.md) \| `null` | How conflicting invitations are handled. Defaults to declining nothing, so the event only blocks time and shows the away status. |
| <a id="property-declinemessage"></a> `declineMessage?` | `string` \| `null` | Message returned to organizers whose invitations are auto-declined. |
