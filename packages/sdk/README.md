Macro's SDK: a Typescript library for harnessing the power of Macro

- **`generated/`**: generated Typescript types and a HeyAPI client from Macro's
  OpenAPI specs.
- **`src/`**: a hand-written ergonomic SDK layer that provides an "orm"-y API.

## Usage

### Getting started

To get started, make a Macro client

```ts
import { Macro } from '@macro-inc/sdk';

const macro = new Macro({ }); // uses MACRO_API_KEY env var
```

### Authenticating

Every request the SDK sends carries exactly one Macro credential. There are three kinds.

| Credential | Minted in | Prefix | Acts as |
| --- | --- | --- | --- |
| API key | Settings → API Keys | `mak_` | the user who minted it |
| Bot token | Settings → Bots | `mbot_` | the bot, optionally on behalf of a user |
| Bearer token | a signed-in session | none (JWT) | the signed-in user |

#### API key

The default for scripts and integrations. Put the key in `MACRO_API_KEY` and construct with no options.

```ts
import { Macro } from '@macro-inc/sdk';

const macro = new Macro({});
const me = await macro.users.me();
```

Or pass it in code. `token` accepts an API key or a bearer token. The SDK picks the header from the prefix.

```ts
const macro = new Macro({ token: process.env.MACRO_API_KEY });
```

The explicit form names the credential kind. Use it when the key is not from an env var, or when it predates the `mak_` prefix.

```ts
const macro = new Macro({
  auth: { type: 'user', apiKey: process.env.MACRO_API_KEY },
});
```

An API key always acts as the user who minted it. `requestedAs` is bot-only.

#### Bot token

```ts
const asBot = new Macro({ auth: { type: 'bot', token: process.env.MACRO_BOT_TOKEN } });
const asWolf = asBot.requestedAs('macro|wolf@macro.com');
```

Bot requests carry an access scope. `user` uses the requested-as user's access, and is the default when `requestedAs` is set. `team` uses the owning team's access, for team-owned bots, and is the default otherwise. Pass `auth: { type: 'bot', token, scope: ... }` to override.

#### Bearer token

A session token, for code running with a signed-in user. Sent as `Authorization: Bearer`. The function form refreshes it.

```ts
const macro = new Macro({ auth: { type: 'user', token: () => session.accessToken() } });
```

#### Which header goes out

The backend rejects a request carrying two credentials with `400 ambiguous credentials`. The SDK sets exactly one.

| You passed | Header sent |
| --- | --- |
| `apiKey: '…'` | `x-macro-user-api-key: …` |
| `token: 'mak_…'` or `MACRO_API_KEY=mak_…` | `x-macro-user-api-key: mak_…` |
| `token: '<jwt>'` or `MACRO_API_KEY=<jwt>` | `Authorization: Bearer <jwt>` |
| `token: 'mbot_…'` | throws. Use `auth: { type: 'bot', token }` or `MACRO_BOT_TOKEN`. |
| `type: 'bot'` | `x-macro-bot-token` plus `x-macro-bot-scope` |

### Accessing our API

Our SDK acts lets you easily access any Macro "resource":

```ts
const doc = macro.documents.byId('doc_123');
const name = await doc.name();
```

```ts
const owner = await doc.owner();
const email = await owner.email();
```

### Creating, mutating, and deleting

```ts
const doc = await macro.documents.create({
  name: 'Weekly update',
  markdown: '# Week 32\n\n- shipped the thing',
});

await doc.rename('Weekly update (final)');
await doc.setTeamShare(true);
await doc.delete(); // soft delete; doc.restore() brings it back
```

### Listing and searching

List/search methods that can page return a genreator that auto-paginates:
iterate with `for await`, and `break` early to stop fetching:

```ts
for await (const doc of macro.documents.recent()) {
  console.log(await doc.name());
}

for await (const hit of macro.documents.search('quarterly revenue')) {
  console.log(hit.webUrl());
}
```

You can request all with `Array.fromAsync(...)`:

```ts
const allDocs = await Array.fromAsync(macro.documents.recent());
```

### Properties and favorites

Most entities carry user-defined properties and can be favorited:

```ts
await doc.favorite();
await doc.setProperty(macro.properties.byId('prop_status'), {
  text: 'In review',
});
const props = await doc.properties();
```

### Databases

Databases are collections of tables. Tables, columns, and views are parts of
a database, not entities of their own, so they come back as handles that
resolve through the database's schema.

Every write to a database's schema or rows is an op sent to one endpoint,
`POST /databases/{id}/ops`. The methods below each send a one-op batch: the
SDK mints the new table, column, and option ids (UUIDv7) itself and builds the
handle it returns from the op's result.

```ts
const database = await macro.databases.create({ name: 'Events' });
const guests = await database.createTable({ name: 'Guests' });
const email = await guests.addColumn({ name: 'Email', type: { type: 'text' } });

// A select column only accepts labels you give it, at creation or later.
const rsvp = await guests.addColumn({
  name: 'RSVP',
  type: { type: 'select', multi: false },
  options: ['Yes', 'No'],
  after: email,
});
await rsvp.addOptions(['Maybe']); // labels it already has are skipped

await guests.rename('Attendees');
await rsvp.rename('Response');

// A relation column holds rows of another table, named by handle.
const hosts = await database.createTable({ name: 'Hosts' });
await guests.addColumn({
  name: 'Host',
  type: { type: 'relation', table: hosts },
});

// See what each type change would do to the existing values first.
const casts = await rsvp.casts();
await rsvp.changeType({ to: { type: 'select', multi: true } });

// A type change converts every value or refuses, naming the misfits. To keep
// the original, add a column of the new type after it, filled with the values
// that convert ("Response (Text)" unless you pass a name).
await rsvp.convertIntoNewColumn({ to: { type: 'text' } });

// Tabs: a new database starts with a "Table 1". Reorder by naming every
// table once, or delete one; a database keeps at least one.
const tables = await database.tables();
await database.reorderTables(tables.toReversed());
await (await database.table('Table 1'))?.delete();
```

A database can also start from a template, which builds its tables, columns,
views and a few sample rows in the same transaction that creates it:

```ts
const templates = await macro.databases.templates();
// [{ id: 'project_tracker', name: 'Project tracker', description, icon }, …]
const launch = await macro.databases.create({
  name: 'Launch',
  template: 'project_tracker',
});
```

Changing a column's type, reordering columns, and deleting a column send the
table version last read as the batch's base version: if the table changed
since, the server refuses with a 409 and nothing is written.
`convertIntoNewColumn` is the exception to one op per call: it reads the
conversion (`POST …/columns/{c}/conversion`, which changes nothing), then sends
one batch that creates the column and fills it, at the version that read saw.

To do several things at once, send the ops yourself. They apply in order in
one transaction, later ops see what earlier ones did, and a refused op leaves
the whole batch unwritten. Each op names the resource it changes (a `table`,
`column`, `rows`, or `view`) and what `change` it makes; each result answers
with the same `kind` and what happened as its own `change`. Ids for new
tables, columns, options, and views are yours to mint, so a later op of the
batch can name them:

```ts
import { v7 as uuidv7 } from 'uuid';

const notes = uuidv7();
const results = await database.applyOps(
  [
    {
      kind: 'column',
      table: guests.id,
      column: notes,
      change: {
        kind: 'create',
        definition: { source: 'new', name: 'Notes', type: { type: 'text' } },
      },
    },
    {
      kind: 'rows',
      table: guests.id,
      change: {
        kind: 'insert',
        rows: [
          [
            { column: email.id, value: { type: 'text', value: 'ada@example.com' } },
            { column: notes, value: { type: 'text', value: 'Vegetarian' } },
          ],
        ],
      },
    },
  ],
  { baseVersions: [{ table: guests, version: await guests.version() }] },
);
// results[1] is { kind: 'rows', table, tableVersion, change: { kind: 'inserted', rows: [rowId] } }
```

A refusal throws `MacroOpRefusedError`, naming the op at fault (`op`, and
`row` / `column` when one is) and, when the batch minted an id that already
names something, that id as `taken` (`{ kind: 'table' | 'column' | 'option' |
'view', id }`). A retried batch whose first attempt committed refuses this way.

```ts
import { MacroOpRefusedError } from '@macro-inc/sdk';

try {
  await database.createTable({ name: 'Guests' });
} catch (error) {
  if (error instanceof MacroOpRefusedError) console.log(error.op, error.taken);
}
```

A table's views are handles too. A board view reads where its cards sit:

```ts
for (const view of await guests.views()) {
  const layout = await view.layout();
  if (layout.kind === 'board') console.log(await view.positions());
}
```

### Rich message helper

Use the `msg` tagged template to build rich message bodies for channel messages
or documents.

```ts
import { msg, here } from '@macro-inc/sdk';

const channel = macro.channels.byId('chan_1');
const user = macro.users.byId('user_1');
await channel.send(msg`Hey ${user}, take a look at ${doc}. cc ${here}`);
```

These will render as @mentions in the Macro UI.

### Posting to a channel webhook

The web UI can hand you a webhook URL and token for a channel. That token is a
bot token, so it goes in the normal place:

```ts
const macro = new Macro({
  auth: { type: 'bot', token: process.env.MACRO_WEBHOOK_TOKEN },
});

await macro.channels
  .byId(channelId)
  .send(msg`Deploy ${sha} finished. ${here}`);
```

# Events

`macro.events` is always available. The default transport is a live SSE
stream — no public URL, persisted webhook, or signing secret required.

```ts
const macro = new Macro({
  token: process.env.MACRO_API_KEY,
});

const me = await macro.users.me();

macro.events.on('message.posted', async ({ metadata, target }) => {
  if (metadata.sender === me.id) return; // don't reply to ourselves
  if (target.type === 'channel') await target.message.reply('hi!');
  else await target.comment.reply('hi!');
});

const stop = await macro.events.listen();
// later: stop();
```

`listen()` opens `GET /webhook/events/stream` with the same `WebhookFilters`
model as persisted webhooks. If you omit `filters`, it derives one filter from
the event names already registered with `.on()`. Pass `scope: 'team'` for a
team workspace (defaults to `'user'`). Delivery is best-effort: there is no
replay if you disconnect.

Handlers receive the same hydrated payloads as webhook deliveries — ORM
handles for every entity the event names.

Four families are delivered: `document.*`, `channel.*`, `message.*`, and
`agent_session.*`. Message events (`posted`, `patched`, `deleted`, `mentioned`,
`attachment_created`, `attachment_removed`) cover channel messages and document
comments alike: `metadata.parent` names the channel or document, and the
hydrated `target` carries a `Channel` plus `Message` (and the `Thread` for a
reply) or a `Document` plus `Comment`. `macro.events.onSelfMention` subscribes to
`message.mentioned` deliveries that name the caller.
Agent-session events describe a coding agent's life: `opened`, `turn_started`,
`turn_ended`, `settled` (a turn ended with nothing queued behind it),
`waiting_for_input` (the agent asked its owner a question), `input_received`,
`mentioned` (a prompt named other users who can see the session), `stopped`,
`renamed`, and `deleted`. Each carries the session's identity and
hydrates to an `AgentSession` handle, the owner `User`, and, for a session
opened from a channel thread, the `Channel`, `Thread`, and magic-chip
`Message` the turn renders into.

```ts
macro.events.on('agent_session.settled', async ({ metadata, session, thread }) => {
  console.log(`${metadata.identity.bot_name} finished: ${metadata.last_turn?.excerpt}`);
  await thread?.reply(msg`Done — see ${session}`);
});
```

### Persisted webhooks

To receive the same events as HTTPS POSTs instead of (or in addition to) SSE,
register a webhook and pass a `webhookSecret` (or set `MACRO_WEBHOOK_SECRET`).
Use a framework like Hono or Express to handle the request; the SDK verifies
the signature and dispatches.

```ts
const macro = new Macro({
  token: process.env.MACRO_API_KEY,
  webhookSecret: process.env.MACRO_WEBHOOK_SECRET,
});

macro.events.on('message.posted', async ({ metadata, target }) => {
  if (metadata.sender === me.id || target.type !== 'channel') return;
  await target.message.reply('hi!');
});

// Hono
app.post('/webhook', (c) => macro.events.webhook()(c.req.raw));
```

Call chat events have `event.target.type === 'call'`, with a `CallRecord` in
`event.target.call` and a `CallMessage` in `event.target.message`. Read with
`content()`, or call `reply(body)`, `edit(body)`, and `delete()`. Replies always
join the call's single chat thread, even when responding to another reply.
`macro.calls.byId(callId).message(messageId)` creates the same lazy message handle.

# Upgrading to 0.2

Channel messages, document comments, and CRM company and contact comments share
one API, `/messages/{parent_type}/{parent_id}`, and the SDK entities follow it.
The old channel message, document comment, and CRM comment routes are removed
from the server in the same release, so 0.1 clients stop working against it.
The public `Channel`, `Message`, `Thread`, `Document`, `Company`, and `Contact`
methods keep their names; these details changed:

- `Channel.messages()` and `Channel.messagesAfter()` page with the structured
  `MessageCursor` and yield `Message` handles seeded from the shared message
  record (`mentions` are now populated from list reads too).
- `Channel.typing(action)` takes `'start' | 'stop'` and posts to
  `/messages/channel/{id}/typing`.
- `Message.from(client, channelId, record)` replaces `Message.from(client, record)`,
  `Message.fromReply`, and `Message.received`.
- `Comment` ids are message UUIDs: `Comment.commentId` is gone, `Comment.threadId()`
  is async and returns the root comment id, `Comment.edit` accepts a rich body, and
  `Comment.reply` exists. `Document.comment(body, { threadId })` takes a string
  thread id and a rich body; `Document.comments()` returns `{ thread: ThreadState,
  comments }` per live thread.
- `CrmComment` is a message-backed comment on its company or contact
  (`parent: { type: 'crm_company' | 'crm_contact', id }`). Its ids are message
  UUIDs (imported comments kept their old ids); `text`, `createdAt`,
  `updatedAt`, and `deletedAt` are lazy accessors; `threadId()` and `author()`
  are async; `edit` accepts a rich body; and `reply` exists. `owner`, `sender`,
  `order`, and `metadata` are gone. `Company.comments()` and
  `Contact.comments()` return `{ thread: ThreadState, comments }` per live
  thread; `comment(body, { threadId })` replaces `comment({ text, threadId })`;
  `commentById(id)` returns a handle; `editComment` and `deleteComment` are
  replaced by `CrmComment.edit` and `CrmComment.delete`. Deleting a thread's
  root keeps its replies, as it does for channel and document threads.
- Webhook and SSE events `channel.message_posted`, `channel.mentioned`,
  `channel.message_patched`, `channel.message_deleted`,
  `channel.message_attachment_created`, and `channel.message_attachment_removed`
  are replaced by `message.posted`, `message.mentioned`, `message.patched`,
  `message.deleted`, `message.attachment_created`, and
  `message.attachment_removed`. Their metadata carries `parent` instead of
  `channel_id`, and handlers receive `target` (see Events above) instead of
  `channel`/`message`/`thread`. `onSelfMention` handlers now receive
  `message.mentioned` events. Update persisted webhook filters accordingly.

Removed storage operations and their replacements: `getChannelMessages` →
`messageTimeline`; `getChannelMessagesCatchUp` → `messageTimeline` with
`activity_after`; `getThreadReplies` → `entityMessageGetThread`;
`getMessageWithContext` → `entityMessageGetMessage` / `messageTimeline` with
`around`; `postMessage` → `entityMessageCreate`; `patchMessage` →
`entityMessageEdit`; `deleteMessage` → `entityMessageDeleteMessage`;
`postReaction` → `entityMessageReact`; `postTyping` → `entityMessageTyping`;
`getDocumentComments` → `messageTimeline` + `entityMessageGetThread` on a
document parent; `createComment` → `entityMessageCreate`; `editComment` →
`entityMessageEdit`; `deleteComment` → `entityMessageDeleteMessage`;
`listCrmComments` → `messageTimeline` + `entityMessageGetThread` on a
`crm_company` or `crm_contact` parent; `createCrmComment` →
`entityMessageCreate`; `editCrmComment` → `entityMessageEdit`;
`deleteCrmComment` → `entityMessageDeleteMessage`.

# Developing

This section is just if you are contributing to the SDK.

## Releases

See [Releasing the SDK](RELEASING.md) for patch version bumps, npm setup,
and tag-triggered publishing. Agents can use the
[`release-sdk`](../../.agents/skills/release-sdk/SKILL.md) skill.

## Coverage checking

We have a coverage checker. It reads every generated function and ensures that
every client function that is generated is called by some hand-written function
in `src/`. If a generated function is not called, the coverage checker will fail
the build.

You can add exceptions for stuff OpenAPI covers that we don't want the sdk to
support by adding them to the `src/coverage/skipped.ts`. You can implement
support by adding a wrapper to the appropriate model. There is CI to ensure that
we don't forget to add coverage or explicitly skip coverage for new generated
functions (endpoints).

## Events

Event names and payloads are **generated from the backend**: the Rust webhook
crate exposes a `WebhookEvent` union in the storage OpenAPI spec, and
`src/events/types.ts` derives `EventName` / `EventPayload` from it. SSE
(`listen()`) and persisted webhooks (`webhook()`) dispatch the same union.
