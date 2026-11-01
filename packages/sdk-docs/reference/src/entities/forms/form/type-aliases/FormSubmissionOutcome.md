# Type Alias: FormSubmissionOutcome

> **FormSubmissionOutcome** = \{ `booking?`: [`FormBookingStep`](FormBookingStep.md); `outcome`: `"submitted"`; `response`: [`FormResponse`](../../response/classes/FormResponse.md); `row`: [`DatabaseRow`](../../../databases/row/classes/DatabaseRow.md); \} \| \{ `message`: `string`; `outcome`: `"stopped"`; `section`: [`FormSection`](../../section/classes/FormSection.md); \}

The result of submitting or editing a response. A stopped submission has no row.
