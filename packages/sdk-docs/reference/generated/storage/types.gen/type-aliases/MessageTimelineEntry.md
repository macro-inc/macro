# Type Alias: MessageTimelineEntry

> **MessageTimelineEntry** = \{ `message`: [`MessageListItem`](MessageListItem.md); `type`: `"message"`; \} \| \{ `activity`: [`TimelineActivity`](TimelineActivity.md); `type`: `"activity"`; \}

One chronological entry in a parent's timeline.

## Union Members

### Type Literal

\{ `message`: [`MessageListItem`](MessageListItem.md); `type`: `"message"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `message` | [`MessageListItem`](MessageListItem.md) | The message and thread state. |
| `type` | `"message"` | - |

***

### Type Literal

\{ `activity`: [`TimelineActivity`](TimelineActivity.md); `type`: `"activity"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `activity` | [`TimelineActivity`](TimelineActivity.md) | The recorded activity. |
| `type` | `"activity"` | - |
