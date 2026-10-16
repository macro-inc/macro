# Type Alias: EmailReminderPage

> **EmailReminderPage** = \{ `items`: [`EmailReminderSummary`](EmailReminderSummary.md)[]; `nextCursor?`: `string` \| `null`; \}

A page of original-email identities and private reminder metadata.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-items"></a> `items` | [`EmailReminderSummary`](EmailReminderSummary.md)[] | Original threads ordered by their snooze return time. |
| <a id="property-nextcursor"></a> `nextCursor?` | `string` \| `null` | Progress through all examined candidates, absent at exhaustion. |
