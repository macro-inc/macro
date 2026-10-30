# Building a bot

A bot is a Macro principal (`bot|<uuid>`) that posts to channels from outside
the app: a webhook relay, a scheduled job, a Cloudflare Worker. This guide
covers who owns a bot, its credentials, the two ways it can post, and acting as
a user. The bot entity lives in [`crates/bots`](../../crates/bots/AGENTS.md);
clients use the [TypeScript SDK](../../packages/sdk).

## Ownership

Every bot is owned by a user or a team. The owner decides which posting path
the bot gets and which users it may act as.

| Owner | Who can create it | How |
| --- | --- | --- |
| User | Any user; the bot belongs to its creator | Settings → Bots, `POST /bots` without `team_id`, or the `CreateBot` tool without `teamId` |
| Team | A team admin or owner | Settings → Bots with "team" selected, `POST /bots` with `team_id`, or `CreateBot` with `teamId` |

Ownership rules are in `owner_for_request` in
`crates/bots/src/domain/service.rs`. System bots (Macro's own) have no owner
and cannot act as anyone.

## Credentials

A bot authenticates with an `mbot_` token sent as `x-macro-bot-token`. The user
mints it from the chat card that `CreateBot` returns or from the bot's
settings; the secret is shown once and never returned by a tool. Treat it as a
secret (`wrangler secret put`, Doppler), never a committed value.

`x-macro-bot-scope` picks the access the request runs with: `team` (the
owning team's access, team-owned bots only) or `user` (the acting user's
access). The SDK defaults it to `user` when `requestedAs` is set and `team`
otherwise.

## Two ways to post

| | Channel webhook | Entity message API |
| --- | --- | --- |
| Endpoint | `POST /channels/{channel_id}/webhook` | `POST /messages/channel/{channel_id}` and `/messages/channel/{channel_id}/items/{id}` |
| Who can use it | Any bot that is a participant of the channel | A team-owned bot, or any bot acting as a user it may act for |
| Body | `content` only | content, mentions, attachments, `thread_id` |
| Threads | No (`thread_id` is always empty) | Yes |
| Mentions | `<m-*>` tags in `content`; the server extracts them | `<m-*>` tags plus a matching `mentions` list |
| Edit, react, delete | No | Yes |
| Images | No | Yes |

The webhook handler is `post_channel_webhook_handler` in
`crates/bots/src/inbound/channel_webhook_router.rs`: it posts the content with
no thread and no mentions list. The message service then extracts mentions
from a bot's content when the list is empty, so mention tags in webhook content
still render and notify.

The SDK picks the path for you. `channel.send(...)` and `thread.reply(...)` go
through `postToChannel` in `packages/sdk/src/entities/channels/post.ts`: the
entity API when the credential has entity access, otherwise the webhook, which
throws for threads and images. `message.edit`, `message.react` and
`message.delete` always use the entity API.

## Acting as a user

A bot acts as a user with the `x-macro-bot-for-macro-user-id` header; in the
SDK, `macro.requestedAs(macro.users.byId(userId))`. Which users it may act as
is checked in `crates/macro_authorization/src/domain/bot_authorizer.rs`:

| Bot owner | May act as |
| --- | --- |
| User | Only its owner |
| Team | Any member of the team |
| System | Nobody |

Acting as a user grants that user's access, so a user-owned bot acting as its
owner can use the full entity message API in any channel its owner can post
in. Messages stay attributed to the bot (the bot is the sender) and record the
user as `triggered_by`.

## Recipe: a Cloudflare Worker bot

Copy the closest existing bot under `services/bots/`:

- [`anthropic-status-bot`](../../services/bots/anthropic-status-bot/README.md):
  webhook in, one flat post out through the channel webhook. Use it when posts
  never need threads, edits or reactions.
- [`goalert-bot`](../../services/bots/goalert-bot/README.md): the full entity
  message API with `requestedAs`, one thread per external event, a Workers KV
  namespace mapping event ids to message ids, and tracing through
  `@macro-inc/observability/worker`.

Both are Hono apps with the SDK imported by relative path, a Bun server for
local runs, `bun test` against fakes, and a single prod `wrangler.jsonc`. Put
the bot token, acting user id and inbound webhook secret in Worker secrets, and
the channel id in `vars`. Register the package in the root `package.json`
workspaces and run `bun install`. Deploying follows the
[new service guide](new-service.md): a person deploys, never an agent.
