# Type Alias: ScheduledActionUpdate

> **ScheduledActionUpdate** = \{ `action_id`: `string`; `chat_id?`: `string` \| `null`; `owner`: `string`; `resource?`: `null` \| [`ExecutionResource`](ExecutionResource.md); `type`: `"started"`; \} \| \{ `action_id`: `string`; `chat_id?`: `string` \| `null`; `is_success`: `boolean`; `owner`: `string`; `resource?`: `null` \| [`ExecutionResource`](ExecutionResource.md); `type`: `"stopped"`; \}

Live status update for a scheduled-action run, broadcast via the connection
gateway to the owner. Clients use the typed resource to navigate to the run
transcript and the variant tag to toggle the running indicator. `chat_id`
remains populated only for chat runs, for older clients.

Serialized with a `type` tag (`started`/`stopped`) and delivered over the
single `scheduled_action_update` message type on the gateway.
