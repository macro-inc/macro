# Type Alias: AgentSessionOriginParent

> **AgentSessionOriginParent** = \{ `id`: `string`; `type`: `string`; \}

The session an agent-session notification is about, and where its magic
chip lives when it was opened from a thread.

The conversation an agent session was opened from: a channel, document,
or initiative. Spelled like the message API's parent for client routing.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-id"></a> `id` | `string` | The parent entity id. |
| <a id="property-type"></a> `type` | `string` | `channel`, `document`, or `initiative`. |
