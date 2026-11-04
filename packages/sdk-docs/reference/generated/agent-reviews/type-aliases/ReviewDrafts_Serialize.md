# Type Alias: ReviewDrafts\_Serialize

> **ReviewDrafts\_Serialize** = \{ `drafts`: [`DraftList`](DraftList.md)\<[`SendEmail`](SendEmail.md)\>; `kind`: `"email"`; \} \| \{ `drafts`: [`DraftList`](DraftList.md)\<[`CreateCalendarEvent_Serialize`](CreateCalendarEvent_Serialize.md)\>; `kind`: `"calendar"`; \} \| \{ `drafts`: \[[`ImportDraft`](ImportDraft.md)\]; `kind`: `"import"`; \}

The drafts a new review presents, keyed by the review's kind.

## Union Members

### Type Literal

\{ `drafts`: [`DraftList`](DraftList.md)\<[`SendEmail`](SendEmail.md)\>; `kind`: `"email"`; \}

Emails, each sent with the SendEmail action (Markdown body).

***

### Type Literal

\{ `drafts`: [`DraftList`](DraftList.md)\<[`CreateCalendarEvent_Serialize`](CreateCalendarEvent_Serialize.md)\>; `kind`: `"calendar"`; \}

Calendar events, each created with the CreateCalendarEvent action.

***

### Type Literal

\{ `drafts`: \[[`ImportDraft`](ImportDraft.md)\]; `kind`: `"import"`; \}

Exactly one staged import plan, approved as one item.
