# Type Alias: ReviewCalendarDraft

> **ReviewCalendarDraft** = \{ `addGoogleMeet?`: `boolean`; `addMacroCall?`: `boolean`; `attendees?`: \{ `email`: `string`; `isOptional?`: `boolean`; \}[]; `calendarId?`: `string` \| `null`; `description?`: `string` \| `null`; `eventType?`: `"default"` \| `"out_of_office"`; `location?`: `string` \| `null`; `outOfOffice?`: \{ `autoDeclineMode?`: `"decline_none"` \| `"decline_all"` \| `"decline_new_only"`; `declineMessage?`: `string` \| `null`; \} \| `null`; `recurrenceLines?`: `string`[]; `reminders?`: \{ `overrides?`: \{ `method`: `string`; `minutes`: `number`; \}[]; `useDefault`: `boolean`; \} \| `null`; `time`: [`EventTime`](../../../../../generated/calendar/types.gen/type-aliases/EventTime.md); `title`: `string`; \}

Calendar drafts use the existing calendar composer and creation action.

## Properties

| Property | Type |
| ------ | ------ |
| <a id="property-addgooglemeet"></a> `addGoogleMeet?` | `boolean` |
| <a id="property-addmacrocall"></a> `addMacroCall?` | `boolean` |
| <a id="property-attendees"></a> `attendees?` | \{ `email`: `string`; `isOptional?`: `boolean`; \}[] |
| <a id="property-calendarid"></a> `calendarId?` | `string` \| `null` |
| <a id="property-description"></a> `description?` | `string` \| `null` |
| <a id="property-eventtype"></a> `eventType?` | `"default"` \| `"out_of_office"` |
| <a id="property-location"></a> `location?` | `string` \| `null` |
| <a id="property-outofoffice"></a> `outOfOffice?` | \{ `autoDeclineMode?`: `"decline_none"` \| `"decline_all"` \| `"decline_new_only"`; `declineMessage?`: `string` \| `null`; \} \| `null` |
| <a id="property-recurrencelines"></a> `recurrenceLines?` | `string`[] |
| <a id="property-reminders"></a> `reminders?` | \{ `overrides?`: \{ `method`: `string`; `minutes`: `number`; \}[]; `useDefault`: `boolean`; \} \| `null` |
| <a id="property-time"></a> `time` | [`EventTime`](../../../../../generated/calendar/types.gen/type-aliases/EventTime.md) |
| <a id="property-title"></a> `title` | `string` |
