# Type Alias: AgentSessionLifecycleEvent

> **AgentSessionLifecycleEvent** = \{ `event_type`: `"agent_session.opened"`; `metadata`: [`SessionOpenedMetadata`](SessionOpenedMetadata.md); \} \| \{ `event_type`: `"agent_session.turn_started"`; `metadata`: [`TurnStartedMetadata`](TurnStartedMetadata.md); \} \| \{ `event_type`: `"agent_session.turn_ended"`; `metadata`: [`TurnEndedMetadata`](TurnEndedMetadata.md); \} \| \{ `event_type`: `"agent_session.command_rejected"`; `metadata`: [`CommandRejectedMetadata`](CommandRejectedMetadata.md); \} \| \{ `event_type`: `"agent_session.settled"`; `metadata`: [`SessionSettledMetadata`](SessionSettledMetadata.md); \} \| \{ `event_type`: `"agent_session.waiting_for_input"`; `metadata`: [`WaitingForInputMetadata`](WaitingForInputMetadata.md); \} \| \{ `event_type`: `"agent_session.input_received"`; `metadata`: [`InputReceivedMetadata`](InputReceivedMetadata.md); \} \| \{ `event_type`: `"agent_session.mentioned"`; `metadata`: [`SessionMentionedMetadata`](SessionMentionedMetadata.md); \} \| \{ `event_type`: `"agent_session.stopped"`; `metadata`: [`SessionStoppedMetadata`](SessionStoppedMetadata.md); \} \| \{ `event_type`: `"agent_session.renamed"`; `metadata`: [`SessionRenamedMetadata`](SessionRenamedMetadata.md); \} \| \{ `event_type`: `"agent_session.deleted"`; `metadata`: [`SessionDeletedMetadata`](SessionDeletedMetadata.md); \}

Events publishable to [`MacroAgentSessionLifecycleTopic`].

The serde tag and [`AgentSessionLifecycleEventName`] spell the same wire
names: subscribers filter on them, so they are API. The
`event_names_match_the_wire` test holds the two in step. Exhaustive on
purpose: a consumer's match should break when a variant is added.

## Union Members

### Type Literal

\{ `event_type`: `"agent_session.opened"`; `metadata`: [`SessionOpenedMetadata`](SessionOpenedMetadata.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event_type` | `"agent_session.opened"` | - |
| `metadata` | [`SessionOpenedMetadata`](SessionOpenedMetadata.md) | A session was created. |

***

### Type Literal

\{ `event_type`: `"agent_session.turn_started"`; `metadata`: [`TurnStartedMetadata`](TurnStartedMetadata.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event_type` | `"agent_session.turn_started"` | - |
| `metadata` | [`TurnStartedMetadata`](TurnStartedMetadata.md) | A prompt was delivered to the runtime. |

***

### Type Literal

\{ `event_type`: `"agent_session.turn_ended"`; `metadata`: [`TurnEndedMetadata`](TurnEndedMetadata.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event_type` | `"agent_session.turn_ended"` | - |
| `metadata` | [`TurnEndedMetadata`](TurnEndedMetadata.md) | The runtime answered a turn. |

***

### Type Literal

\{ `event_type`: `"agent_session.command_rejected"`; `metadata`: [`CommandRejectedMetadata`](CommandRejectedMetadata.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event_type` | `"agent_session.command_rejected"` | - |
| `metadata` | [`CommandRejectedMetadata`](CommandRejectedMetadata.md) | An accepted command was refused before runtime execution. |

***

### Type Literal

\{ `event_type`: `"agent_session.settled"`; `metadata`: [`SessionSettledMetadata`](SessionSettledMetadata.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event_type` | `"agent_session.settled"` | - |
| `metadata` | [`SessionSettledMetadata`](SessionSettledMetadata.md) | A turn ended with nothing queued behind it. |

***

### Type Literal

\{ `event_type`: `"agent_session.waiting_for_input"`; `metadata`: [`WaitingForInputMetadata`](WaitingForInputMetadata.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event_type` | `"agent_session.waiting_for_input"` | - |
| `metadata` | [`WaitingForInputMetadata`](WaitingForInputMetadata.md) | The agent is blocked on a question to its owner. |

***

### Type Literal

\{ `event_type`: `"agent_session.input_received"`; `metadata`: [`InputReceivedMetadata`](InputReceivedMetadata.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event_type` | `"agent_session.input_received"` | - |
| `metadata` | [`InputReceivedMetadata`](InputReceivedMetadata.md) | The question was answered or withdrawn. |

***

### Type Literal

\{ `event_type`: `"agent_session.mentioned"`; `metadata`: [`SessionMentionedMetadata`](SessionMentionedMetadata.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event_type` | `"agent_session.mentioned"` | - |
| `metadata` | [`SessionMentionedMetadata`](SessionMentionedMetadata.md) | A prompt named other users who can open the session. |

***

### Type Literal

\{ `event_type`: `"agent_session.stopped"`; `metadata`: [`SessionStoppedMetadata`](SessionStoppedMetadata.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event_type` | `"agent_session.stopped"` | - |
| `metadata` | [`SessionStoppedMetadata`](SessionStoppedMetadata.md) | The session's live actor is gone. |

***

### Type Literal

\{ `event_type`: `"agent_session.renamed"`; `metadata`: [`SessionRenamedMetadata`](SessionRenamedMetadata.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event_type` | `"agent_session.renamed"` | - |
| `metadata` | [`SessionRenamedMetadata`](SessionRenamedMetadata.md) | The session was renamed. |

***

### Type Literal

\{ `event_type`: `"agent_session.deleted"`; `metadata`: [`SessionDeletedMetadata`](SessionDeletedMetadata.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event_type` | `"agent_session.deleted"` | - |
| `metadata` | [`SessionDeletedMetadata`](SessionDeletedMetadata.md) | The session was deleted. |
