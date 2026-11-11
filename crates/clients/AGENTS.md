# crates/clients

## What it is

Outbound HTTP and SDK clients: clients for Macro's own services (`*_service_client`), for vendors (FusionAuth, Gmail, Loops, Anthropic, OpenSearch, MCP servers), and the Redis-backed cache client. A client crate holds no domain logic; domain crates implement their ports over it.

Layer: `clients` in [`.config/layers.toml`](../../.config/layers.toml), which
lists what this group may depend on. `cargo x deps` reports edges that break it.

## Crates

| Crate | What it is |
| --- | --- |
| `analytics_client` |  |
| [`anthropic`](anthropic/AGENTS.md) | Part of AI: the SDK client for the Anthropic Messages API that the rest of the product's AI surfaces (via `agent`) build requests against, plus an OpenAI-compatible … |
| [`authentication_service_client`](authentication_service_client/AGENTS.md) | Part of shared infrastructure: the typed Rust client other services use to call `authentication_service`'s internal API (users, Google access tokens, AI billing hooks … |
| [`connect_client`](connect_client/AGENTS.md) | A pinned copy of Macro Connect's public Rust client, `crates/clients/connect_client` in the private repo macro-inc/macro-connect, at commit `0814a61`. |
| [`connection_gateway_client`](connection_gateway_client/AGENTS.md) | Part of shared infrastructure: the HTTP client for `services/connection_gateway`, pushing best-effort realtime messages (invalidation events, channel messages … |
| [`document_storage_service_client`](document_storage_service_client/AGENTS.md) | Shared infrastructure for the Documents feature (and the other entities DSS hosts): a Rust HTTP client for `document_storage_service` (DSS) covering documents, projects … |
| [`email_service_client`](email_service_client/AGENTS.md) | Part of the Email feature: a Rust HTTP client for `email_service` — message/thread lookups by id, thread owner lookup, a user's newest inbox messages read live from the … |
| [`fusionauth`](fusionauth/AGENTS.md) | Backs the Authentication feature: a FusionAuth API client for OAuth/identity-provider login, user management, JWTs, and passwordless/password flows against the … |
| [`gmail_client`](gmail_client/AGENTS.md) | Backs the Email feature's Gmail sync: a thin Gmail API client, `GmailClient`, wrapping per-area modules (messages, threads, labels, filters, history, contacts, watch) … |
| [`incus_client`](incus_client/AGENTS.md) | Rust client for the Incus REST API, for the Macro computers fleet adapter that creates, powers, and inspects box VMs on Incus hosts. |
| [`lexical_client`](lexical_client/AGENTS.md) | Belongs to Documents: the Rust-side HTTP client for `lexical_service`, plus a parser for Lexical's markdown subset, used by any backend crate that needs to read or … |
| `loops_client` |  |
| [`macro_cache_client`](macro_cache_client/AGENTS.md) | Belongs to shared infrastructure (authentication): Redis-backed rate limiters for auth-adjacent flows, one module per limited action, each gated behind its own Cargo … |
| `macro_redis` |  |
| [`macro_sha_count_client`](macro_sha_count_client/AGENTS.md) | Part of document/file storage. |
| [`mcp_client`](mcp_client/AGENTS.md) | Part of agent sessions / AI tooling. |
| [`opensearch_client`](opensearch_client/AGENTS.md) | Part of the Search feature. |
| [`opensearch_query_builder`](opensearch_query_builder/AGENTS.md) | Part of the Search feature. |
| [`search_service_client`](search_service_client/AGENTS.md) | Part of the Search feature. |
| [`static_file_service_client`](static_file_service_client/AGENTS.md) | Shared infrastructure for attachments and uploads — the HTTP client for the static file service (SFS): put, get, and delete a file by key over … |
| [`sync_service_client`](sync_service_client/AGENTS.md) | Part of the Documents (collaborative editing/sync) feature — the HTTP client for the deployed sync service (`services/sync-service`, a Cloudflare Durable Object) … |

## Recipes

- Add a crate here: create `crates/clients/<name>` with its own `AGENTS.md`
  (from `.agents/templates/AGENTS.md`), add it to the root `members` and run
  `cargo x deps`, which adds its `[workspace.dependencies]` entry once
  something depends on it. Add it to the table above.
