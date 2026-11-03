# Type Alias: ReviewDraft\_Deserialize

> **ReviewDraft\_Deserialize** = \{ `draft`: [`SendEmail`](SendEmail.md); `kind`: `"email"`; \} \| \{ `draft`: [`CreateCalendarEvent_Deserialize`](CreateCalendarEvent_Deserialize.md); `kind`: `"calendar"`; \} \| \{ `draft`: [`ImportDraft`](ImportDraft.md); `kind`: `"import"`; \}

One replacement draft, keyed by the kind of the review it edits.

## Union Members

### Type Literal

\{ `draft`: [`SendEmail`](SendEmail.md); `kind`: `"email"`; \}

An edited email.

***

### Type Literal

\{ `draft`: [`CreateCalendarEvent_Deserialize`](CreateCalendarEvent_Deserialize.md); `kind`: `"calendar"`; \}

An edited calendar event.

***

### Type Literal

\{ `draft`: [`ImportDraft`](ImportDraft.md); `kind`: `"import"`; \}

An edited import plan selection.
