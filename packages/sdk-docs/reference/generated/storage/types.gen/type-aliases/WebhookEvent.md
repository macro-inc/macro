# Type Alias: WebhookEvent

> **WebhookEvent** = [`DocumentTopicEvent`](DocumentTopicEvent.md) \| [`ChannelTopicEvent`](ChannelTopicEvent.md) \| [`MessageTopicEvent`](MessageTopicEvent.md) \| [`AgentSessionLifecycleEvent`](AgentSessionLifecycleEvent.md)

Any entity event deliverable to a webhook endpoint.

Serialized bodies carry an `event_type` tag naming the event (for example
`document.created` or `message.posted`) and a `metadata` object
with the event payload. Endpoint validation additionally sends a
`WebhookValidationTestEvent`, which is not part of this union.
