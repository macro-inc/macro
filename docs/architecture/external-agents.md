# External agents

An external agent is an assistant that runs outside Macro (a hosted bot, an
assistant on another platform, a script on a laptop) and takes part in Macro
conversations as an agent: people DM it and @mention it, and it answers in
the conversation. Its runtime needs one credential, a bot token, and either a
public HTTPS endpoint or nothing at all.

## How it works

```text
 person DMs / @mentions the agent
        │ committed message
        ▼
 agent_trigger_service ── decides the message addressed the agent
        │ agent_trigger.new on macro.agent_sessions
        ▼
 DSS external-agent-inbox consumer (crates/external_agents)
        │ one row in external_agent_events per trigger
        ├──────────────► endpoint registered? queue external_agent.message
        │                on the webhook delivery queue (signed, retried)
        ▼
 runtime polls  externalAgent.events(after)        runtime receives the push
        └───────────────┬───────────────────────────────┘
                        ▼
 replyToExternalAgentEvent(eventId, text) ── posted as the agent, in the DM
                                             timeline or the mention's thread
```

- **Identity.** An external agent is an agent persona (a bot with an agent
  configuration) on the `external` harness. DMs, mentions, the agent lists,
  and the agent trigger's rules (owner or team, channel scope, hop limit)
  apply unchanged. Nothing in Macro runs it: the harness service skips it.
- **Inbox.** Every message that addresses it becomes one event in
  `external_agent_events`: a top-level turn in someone's DM with it
  (`direct_message`) or a mention anywhere it may answer (`mention`). A
  redelivered trigger records nothing new.
- **Delivery.** With an endpoint, each event is pushed through the webhook
  delivery queue with the webhook pipeline's signing, retry schedule, and
  delivery records. The endpoint is an ordinary webhook in the owner's
  workspace whose filter names `external_agent.message`. Without one, the
  runtime polls; it can also poll with one, to catch up after downtime.
- **Replies.** A reply names an event. The event fixes the conversation, the
  thread (the DM timeline for a direct message, the message's thread for a
  mention), and the person whose current write access the reply is posted
  with, attributed to them like any agent reply. An agent can answer only its
  own events, and nothing is posted for someone who can no longer write there.

## Integrating a runtime

Connect the agent in Settings → Agents → External agents (or call
`registerExternalAgent`). Keep the bot token, and the signing secret if you
gave an endpoint; both are shown once. Every call below is a GraphQL request:

```text
POST https://<document-storage-service>/items/soup/graphql
x-macro-bot-token: mbot_…
Content-Type: application/json
```

### Receiving events

Pushed events are an HTTPS `POST` with these headers, signed as for any
Macro webhook (see `crates/webhook/README.md`):

- `X-Macro-Event: external_agent.message`, `X-Macro-Event-Id: <event id>`
- `X-Macro-Timestamp` and `X-Macro-Signature: v1=<hex HMAC-SHA256>` over
  `<timestamp>.<raw body>` with the signing secret.

Answer 2xx quickly; anything else is retried. Registration and `Verify` send a
signed `webhook.validation.test` event first: an endpoint that does not answer
2xx is not pushed anything until it is verified. The body:

```json
{
  "event_id": "019a4f0e-…",
  "schema_version": 1,
  "event_type": "external_agent.message",
  "metadata": {
    "agent_id": "019a4f0d-…",
    "kind": "direct_message",
    "conversation": { "type": "channel", "id": "019a4f0c-…" },
    "message": {
      "id": "019a4f0e-…",
      "thread_id": null,
      "sender_id": "macro|person@example.com",
      "text": "What changed today?",
      "created_at": "2026-11-04T00:00:00Z"
    }
  }
}
```

Polling reads the same events, oldest first; pass the last id as `after`:

```graphql
query { externalAgent { id events(after: "<last event id>", limit: 50) {
  id kind conversationType conversationId messageId threadId senderId text sentAt
} } }
```

### Answering

```graphql
mutation { replyToExternalAgentEvent(input: {
  eventId: "<event id>", text: "Here is what changed…", messageId: "<optional UUIDv7>"
}) { messageId conversationId threadId } }

mutation { setExternalAgentTyping(input: { eventId: "<event id>", active: true }) }
```

Call `replyToExternalAgentEvent` once per message to send several. Pass your
own UUIDv7 `messageId` to make retries safe: a repeat answers `CONFLICT`
instead of posting twice. Typing shows where the reply will appear and lapses
after about eight seconds unless renewed. Errors carry `extensions.code`:
`NOT_FOUND` (not your event, or its author can no longer write there),
`BAD_USER_INPUT`, `CONFLICT`, `UNAUTHENTICATED`.

A minimal pushed runtime, in TypeScript on Bun:

```ts
const SECRET = process.env.MACRO_SIGNING_SECRET!;
const TOKEN = process.env.MACRO_BOT_TOKEN!;
const API = process.env.MACRO_AGENT_API!; // …/items/soup/graphql

async function signed(body: string, timestamp: string, signature: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key,
    new TextEncoder().encode(`${timestamp}.${body}`));
  return signature === `v1=${Buffer.from(digest).toString('hex')}`;
}

Bun.serve({ port: 8787, async fetch(request) {
  const body = await request.text();
  const ok = await signed(body, request.headers.get('x-macro-timestamp') ?? '',
    request.headers.get('x-macro-signature') ?? '');
  if (!ok) return new Response('bad signature', { status: 401 });
  const event = JSON.parse(body);
  if (event.event_type === 'external_agent.message') {
    await fetch(API, { method: 'POST',
      headers: { 'x-macro-bot-token': TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({
        query: 'mutation($input: ReplyToExternalAgentEventInput!) { replyToExternalAgentEvent(input: $input) { messageId } }',
        variables: { input: { eventId: event.event_id, text: `You said: ${event.metadata.message.text}` } },
      }) });
  }
  return new Response(null, { status: 204 });
} });
```

## Limits

- Replies in a thread without a new mention are not delivered: an external
  agent has no session for the agent trigger to route follow-ups to.
- Task assignments and composer session requests carry no message, so they
  are not delivered.
- The signing secret is stored as the webhook crate stores every webhook
  secret today (see `crates/webhook/README.md`, Temporary limitations).
- Inbox events keep the message text they were recorded with; deleting the
  agent deletes its inbox.

## Code map

- `crates/external_agents`: registry, inbox, agent API, the Kafka consumer,
  and the `external_agent.message` contract (`src/domain/models.rs`).
- `crates/graphql_external_agent`: the GraphQL surface for owners and agents.
- `services/document_storage_service/src/api/graphql_soup.rs`: the bot-token
  GraphQL path, which inserts the agent and never a user.
- `apps/web/src/features/external-agents`: the settings section.
