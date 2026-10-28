# Type Alias: AgentSessionQueueResponse

> **AgentSessionQueueResponse** = \{ `entries`: [`QueuedActionDto`](QueuedActionDto.md)[]; \}

Response body for a session's queue: everything waiting, oldest first.

A wrapper rather than a bare array so that anything which is about the
response rather than about an entry has somewhere to go later without
breaking every client.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-entries"></a> `entries` | [`QueuedActionDto`](QueuedActionDto.md)[] | The waiting actions, in dispatch order. |
