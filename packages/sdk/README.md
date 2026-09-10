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

macro.events.on('channel.message_posted', async ({ metadata, message }) => {
  if (metadata.sender === me.id) return; // don't reply to ourselves
  await message.reply('hi!');
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

macro.events.on('channel.message_posted', async ({ metadata, message }) => {
  if (metadata.sender === me.id) return;
  await message.reply('hi!');
});

// Hono
app.post('/webhook', (c) => macro.events.webhook()(c.req.raw));
```

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
