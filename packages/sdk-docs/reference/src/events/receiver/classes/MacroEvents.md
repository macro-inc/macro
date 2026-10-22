# Class: MacroEvents

Per-instance event receiver. Subscribe with [MacroEvents.on](#on), then
either [MacroEvents.listen](#listen) (SSE, the default) or mount
[MacroEvents.webhook](#webhook) at a persisted webhook URL.

Obtain via `macro.events` — do not construct directly.

## Constructors

### Constructor

> **new MacroEvents**(`client`, `secret?`): `MacroEvents`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `secret?` | `string` |

#### Returns

`MacroEvents`

## Methods

### handle()

> **handle**(`rawBody`, `headers`): `Promise`\<`void`\>

Feed a raw webhook delivery in: verifies the signature, parses, and
dispatches to matching handlers.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `rawBody` | `string` |
| `headers` | `DeliveryHeaders` |

#### Returns

`Promise`\<`void`\>

#### Throws

if no signing secret was configured, or if the
  signature is missing or invalid.

***

### listen()

> **listen**(`opts?`): `Promise`\<() => `void`\>

Open a live Server-Sent Events stream of matching broker events. This is
the default way to receive events — no public URL or signing secret
required. Delivery is best-effort: events published before the
connection, while disconnected, or dropped for a slow subscriber are
missed; there is no replay.

Filters default to the event names currently registered with [on](#on).
The stream uses those filters for its lifetime; later `.on` / unsubscribe
calls do not change what the server sends.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts?` | [`ListenOptions`](../interfaces/ListenOptions.md) |

#### Returns

`Promise`\<() => `void`\>

A function that closes the stream.

***

### on()

> **on**\<`E`\>(`event`, `handler`): () => `void`

Subscribe to an event across all entities.

#### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-e"></a> `E` *extends* `"agent_session.opened"` \| `"agent_session.turn_started"` \| `"agent_session.turn_ended"` \| `"agent_session.command_rejected"` \| `"agent_session.settled"` \| `"agent_session.waiting_for_input"` \| `"agent_session.input_received"` \| `"agent_session.mentioned"` \| `"agent_session.stopped"` \| `"agent_session.renamed"` \| `"agent_session.deleted"` \| `"channel.picture_changed"` \| `"channel.created"` \| `"channel.updated"` \| `"channel.deleted"` \| `"channel.participant_added"` \| `"channel.participant_removed"` \| `"channel.access_requested"` \| `"document.created"` \| `"document.updated"` \| `"document.deleted"` \| `"document.content_uploaded"` \| `"document.sync_content_updated"` \| `"document.purged"` \| `"document.copied"` \| `"document.interaction"` \| `"message.posted"` \| `"message.patched"` \| `"message.deleted"` \| `"message.mentioned"` \| `"message.attachment_created"` \| `"message.attachment_removed"` |

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `event` | `E` |
| `handler` | `EventHandler`\<`E`\> |

#### Returns

An unsubscribe function.

() => `void`

***

### onSelfMention()

> **onSelfMention**(`handler`): () => `void`

Subscribe to @-mentions of the authenticated caller: `message.mentioned`
deliveries whose mentioned entity is this bot (bot auth) or this user
(user auth), in channels and in document comments alike.

`message.mentioned` deliveries cover every mention the stream's (or
webhook's) workspace can access (its `ids` filter holds channel or
document ids); picking out "me" happens here, client-side. The caller's
identity is resolved lazily (once) on the first delivery.

For SSE, register this handler before [listen](#listen) so the derived
filters include `message.mentioned`. For persisted webhooks, register the
webhook separately, e.g. `macro.webhooks.create({ filters: [{ events:
['message.mentioned'] }], … })`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `handler` | `EventHandler`\<`"message.mentioned"`\> |

#### Returns

An unsubscribe function.

() => `void`

***

### webhook()

> **webhook**(): (`req`) => `Promise`\<`Response`\>

A Fetch-style handler to mount at your persisted webhook route.

Requires `webhookSecret` (or `MACRO_WEBHOOK_SECRET`).

#### Returns

(`req`) => `Promise`\<`Response`\>

#### Example

```ts
app.post('/webhook', macro.events.webhook()); // Hono
```
