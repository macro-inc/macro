# crates

## What it is

Reusable backend libraries, domain crates and adapters, grouped one level deep
by feature. A group's `AGENTS.md` lists its crates. Layering rules between
groups live in [`.config/layers.toml`](../.config/layers.toml) and are checked
by `cargo x deps`; see [Rust development](../docs/development/rust.md#crate-layers).

## Groups

| Group | Layer | What it holds |
| --- | --- | --- |
| [`accounts/`](accounts/AGENTS.md) | domain | Accounts and teams: team membership and seats, onboarding, user API keys and languages, invites, account managers, system status, the native app service, last-online tracking, and the Microsoft OAuth grant and mobile welcome email stores. |
| [`agents/`](agents/AGENTS.md) | domain | Agent sessions: sessions and their realtime fan-out, the harness that runs agents, triggers, bots and harness registrations, Codex and Cursor cloud agents, routines and scheduled actions, skills, prompts, code execution and code mode, dynamic UI, and the transcript folds (`agent_fold`, `claude_fold`, `codex_fold`). |
| [`ai/`](ai/AGENTS.md) | domain | AI building blocks: the LLM loop (`agent`), the AI tool registry and toolsets, AI projections, attachments, embeddings, image generation, yes/no classification (`jev_classifier`), memory, MCP selection and toolsets, Pipedream MCP, universal input, dictation and web search. |
| [`aws/`](aws/AGENTS.md) | aws | AWS SDK adapters: one thin crate per AWS service the backend calls, plus `macro_aws_config` (shared SDK config) and `sqs_worker` (the SQS polling loop that queue consumers are built on). |
| [`billing/`](billing/AGENTS.md) | domain | Billing: AI usage metering and quota admission (`ai_usage`, `ai_billing`, which talks to Stripe) and referrals. |
| [`calendar/`](calendar/AGENTS.md) | domain | Calendar: events, sync and sharing (`calendar_events`), scheduling links (`calendar_scheduling`), and the cal.com booking webhooks (`cal`). |
| [`client/`](client/README.md) | client | Browser, Tauri and wasm crates: the client cache core, its Turso and wasm builds, and the OPFS store. |
| [`clients/`](clients/AGENTS.md) | clients | Outbound HTTP and SDK clients: clients for Macro's own services (`*_service_client`), for vendors (FusionAuth, Gmail, Loops, Anthropic, OpenSearch, MCP servers), and the Redis-backed cache client. |
| [`comms/`](comms/AGENTS.md) | domain | Messaging: channels and their messages, labels and bots, AI chat (`chat`), calls, contacts, the connection gateway port, Slack integration and external chats, mention parsing, and their shared store (`comms_db_client`). |
| [`databases/`](databases/AGENTS.md) | domain | Databases and their neighbours: the database domain, the SQL engine (`database_sql_engine`, also built to wasm for the browser) and its Postgres runner (`database_sql_runner`), webhooks, forms, custom properties and system properties, saved views, and CRM, which is built on databases. |
| [`documents/`](documents/AGENTS.md) | domain | Documents: the document domain (blocks, uploads, conversions, sharing), collaborative surfaces, the native sync service domain (`sync_service_hex`) and its router, static files, and Lexical mention extraction. |
| [`email/`](email/AGENTS.md) | domain | Email: the email domain (sync, threads, drafts, sending, scheduled and focus processing), the Gmail and Outlook API client, its stores, formatting and validation helpers, invite and reminder emails, and Google token handling. |
| [`engines/`](engines/AGENTS.md) | engines | File-format engines: PowerPoint, Word, Figma, Photoshop and Illustrator readers, renderers and writers. |
| [`entities/`](entities/AGENTS.md) | domain | Entities and sharing: entity access checks and their stores, sharing and permission grants, roles, access requests, the entity registry, foreign entities, entity mutations, favorites and frecency. |
| [`graphql/`](graphql/AGENTS.md) | graphql | GraphQL adapters over the domain crates, and `complete_graph`, which composes them into the schema the document storage service serves. |
| [`integrations/`](integrations/AGENTS.md) | domain | Integrations with outside tools: GitHub (the app, pull requests, patches), inbound webhooks and their signatures, the Notion, Linear and Jira importers with their tracker, Granola sync, and link unfurling. |
| [`notifications/`](notifications/AGENTS.md) | domain | Notifications: the notification domain (creation, fan-out, push and email delivery), its storage, the notification inbox, and `model_notifications`, the per-kind notification payloads other domains emit. |
| [`platform/`](platform/AGENTS.md) | platform | Service plumbing every backend binary shares: configuration and env vars (`macro_config`, `macro_env_var`), service URLs and queue names, startup and tracing (`macro_entrypoint`, `genai_telemetry`), HTTP middleware and auth extraction, Kafka events, rate limiting and feature flags. |
| [`projects/`](projects/AGENTS.md) | domain | Projects and folders: `initiative` (the product's projects: named groups of tasks) and its description surface, `projects` (folder organization in Drive), and task deduplication. |
| [`search/`](search/AGENTS.md) | domain | Soup and search: Soup (the unified entity listing behind Home and search) with its realtime fan-out and wire models, item filters, name and full-text search, the work feed, activity and the attention feed. |
| [`testing/`](testing/AGENTS.md) | testing | Test support: the local end-to-end suite that drives an isolated local stack (`local_e2e`), and the helpers other crates' tests use against it. |
| [`types/`](types/AGENTS.md) | types | Leaf value types shared across the backend and the web client: ids (`macro_user_id`, `bot_id`, `harness_id`), tokens, entity kinds, owners and error responses, and the `model`/`models_<area>` wire models. |
| [`whatsapp/`](whatsapp/AGENTS.md) | domain | WhatsApp linked devices: the `whatsmeow` protocol port with its protobufs and Signal session code, the linked-device domain, its Postgres store, and a fake server plus end-to-end tests. |

## Not grouped

These stay at the top level:

- `workspace-hack`: hakari's generated crate; CI and hakari expect this path.
- `macro_db_client` (with `migrations/`) and `macro_db_migrator`: the
  migrations path is wired into CODEOWNERS, `just` recipes, CI actions and
  every `#[sqlx::test(migrations = ...)]`.
- `predicate_index`, `soup_filter_cache_adapter`, `soup_filter_projection`
  and `item_filter_index`: `apps/web/tauri` builds them by path, and editing
  its manifests trips the native store-release gates. They move with
  `client/` in a native release.
- `coding_agent_worker` (macrod): the public install command fetches
  `install/install.sh` from this path on `main`.

## Recipes

- New crate: put it in the group for its feature (dir = package = lib name,
  snake_case), with an `AGENTS.md` from `.agents/templates/AGENTS.md` and a
  `CLAUDE.md` symlink. Add it to the root `members` and run `cargo x deps`.
- Move a crate between groups: `git mv`, fix the root `members` and
  `[workspace.dependencies]` path, then `git grep -n crates/<old>` and run
  `cargo x deps`.
