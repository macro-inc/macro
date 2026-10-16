# Type Alias: CreateReview

> **CreateReview** = \{ `drafts`: `unknown`[]; `executionId?`: `null` \| [`ExecutionId`](ExecutionId.md); `kind`: [`ReviewKind`](ReviewKind.md); `title`: `string`; \}

Review creation. Drafts are validated by the action's owning adapter.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-drafts"></a> `drafts` | `unknown`[] | One to one hundred independent drafts. Email: {subject, body: Markdown, to: [{email, name?}], cc?: [{email, name?}], bcc?: [{email, name?}], replyingToId?, attachments?: [{documentId}]}. Calendar: {title, time: {kind: "timed", startsAt: ISO datetime, endsAt: ISO datetime, timeZone?: IANA zone} or {kind: "allDay", startDate: ISO date, endDate: exclusive ISO date}, description?, location?, attendees?: [{email, isOptional?}]}. Creating any review only presents these drafts; the user acts separately. |
| <a id="property-executionid"></a> `executionId?` | `null` \| [`ExecutionId`](ExecutionId.md) | - |
| <a id="property-kind"></a> `kind` | [`ReviewKind`](ReviewKind.md) | Existing UI and action to use. |
| <a id="property-title"></a> `title` | `string` | Stack label. |
