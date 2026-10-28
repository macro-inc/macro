# Type Alias: SubmissionOutcome

> **SubmissionOutcome** = \{ `booking?`: [`UnlockedBooking`](UnlockedBooking.md); `outcome`: `"submitted"`; `response`: `string`; `row`: `string`; \} \| \{ `message`: `string`; `outcome`: `"stopped"`; `section`: `string`; \}

What a submission came to.

## Union Members

### Type Literal

\{ `booking?`: [`UnlockedBooking`](UnlockedBooking.md); `outcome`: `"submitted"`; `response`: `string`; `row`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `booking?` | [`UnlockedBooking`](UnlockedBooking.md) | The form's booking step, unlocked by this accepted response. |
| `outcome` | `"submitted"` | - |
| `response` | `string` | The ledger entry. |
| `row` | `string` | The row holding the answers. |

***

### Type Literal

\{ `message`: `string`; `outcome`: `"stopped"`; `section`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `message` | `string` | The gate's message. |
| `outcome` | `"stopped"` | - |
| `section` | `string` | The gate. |
