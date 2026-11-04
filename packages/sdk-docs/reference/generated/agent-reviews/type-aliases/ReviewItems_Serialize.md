# Type Alias: ReviewItems\_Serialize

> **ReviewItems\_Serialize** = \{ `items`: [`ReviewItem`](ReviewItem.md)\<[`SendEmail`](SendEmail.md), [`SendEmailResponse`](SendEmailResponse.md)\>[]; `kind`: `"email"`; \} \| \{ `items`: [`ReviewItem`](ReviewItem.md)\<[`CreateCalendarEvent_Serialize`](CreateCalendarEvent_Serialize.md), [`ToolCalendarEvent`](ToolCalendarEvent.md)\>[]; `kind`: `"calendar"`; \} \| \{ `items`: \[[`ReviewItem`](ReviewItem.md)\<[`ImportDraft`](ImportDraft.md), [`NotionImportReport_Serialize`](NotionImportReport_Serialize.md)\>\]; `kind`: `"import"`; \}

Saved items keyed by the review's kind.

## Union Members

### Type Literal

\{ `items`: [`ReviewItem`](ReviewItem.md)\<[`SendEmail`](SendEmail.md), [`SendEmailResponse`](SendEmailResponse.md)\>[]; `kind`: `"email"`; \}

Email drafts and their send responses.

***

### Type Literal

\{ `items`: [`ReviewItem`](ReviewItem.md)\<[`CreateCalendarEvent_Serialize`](CreateCalendarEvent_Serialize.md), [`ToolCalendarEvent`](ToolCalendarEvent.md)\>[]; `kind`: `"calendar"`; \}

Calendar drafts and their created events.

***

### Type Literal

\{ `items`: \[[`ReviewItem`](ReviewItem.md)\<[`ImportDraft`](ImportDraft.md), [`NotionImportReport_Serialize`](NotionImportReport_Serialize.md)\>\]; `kind`: `"import"`; \}

The import plan selection and the started write's report.
