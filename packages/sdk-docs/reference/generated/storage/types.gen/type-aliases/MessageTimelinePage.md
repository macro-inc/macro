# Type Alias: MessageTimelinePage

> **MessageTimelinePage** = \{ `entries`: [`MessageTimelineEntry`](MessageTimelineEntry.md)[]; `next_cursor?`: `null` \| [`MessageCursor`](MessageCursor.md); `previous_cursor?`: `null` \| [`MessageCursor`](MessageCursor.md); \}

A bounded, newest-first window of a parent's messages and activity, ordered
by the server on one `(timestamp, id)` keyset.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-entries"></a> `entries` | [`MessageTimelineEntry`](MessageTimelineEntry.md)[] | Messages and activity, newest first. |
| <a id="property-next_cursor"></a> `next_cursor?` | `null` \| [`MessageCursor`](MessageCursor.md) | - |
| <a id="property-previous_cursor"></a> `previous_cursor?` | `null` \| [`MessageCursor`](MessageCursor.md) | - |
