# Type Alias: MyResponse

> **MyResponse** = \{ `answers`: [`Answer`](Answer.md)[]; `booking?`: [`UnlockedBooking`](UnlockedBooking.md); `response`: [`FormResponse`](FormResponse.md); \}

A signed-in respondent's own response, with its answers as the row
holds them now.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-answers"></a> `answers` | [`Answer`](Answer.md)[] | The row's cells for the form's current questions, the empty ones left out; none when the row is gone. |
| <a id="property-booking"></a> `booking?` | [`UnlockedBooking`](UnlockedBooking.md) | The form's booking step, while the saved row still passes the form's current required questions and gates. |
| <a id="property-response"></a> `response` | [`FormResponse`](FormResponse.md) | The ledger entry. |
