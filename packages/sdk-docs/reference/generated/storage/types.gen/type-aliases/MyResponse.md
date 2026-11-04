# Type Alias: MyResponse

> **MyResponse** = \{ `answers`: [`Answer`](Answer.md)[]; `booking?`: [`UnlockedBooking`](UnlockedBooking.md); `kind`: `"saved"`; `response`: [`FormResponse`](FormResponse.md); \} \| \{ `kind`: `"anonymous"`; \}

A signed-in respondent's own response.

## Union Members

### Type Literal

\{ `answers`: [`Answer`](Answer.md)[]; `booking?`: [`UnlockedBooking`](UnlockedBooking.md); `kind`: `"saved"`; `response`: [`FormResponse`](FormResponse.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `answers` | [`Answer`](Answer.md)[] | The row's cells for the form's current questions, the empty ones left out; none when the row is gone. |
| `booking?` | [`UnlockedBooking`](UnlockedBooking.md) | The form's booking step, while the saved row still passes the form's current required questions and gates. |
| `kind` | `"saved"` | - |
| `response` | [`FormResponse`](FormResponse.md) | The ledger entry. |

***

### Type Literal

\{ `kind`: `"anonymous"`; \}
