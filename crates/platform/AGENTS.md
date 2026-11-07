# crates/platform

## What it is

Service plumbing every backend binary shares: configuration and env vars (`macro_config`, `macro_env_var`), service URLs and queue names, startup and tracing (`macro_entrypoint`, `genai_telemetry`), HTTP middleware and auth extraction, Kafka events, rate limiting and feature flags. No product logic lives here.

Layer: `platform` in [`.config/layers.toml`](../../.config/layers.toml), which
lists what this group may depend on. `cargo x deps` reports edges that break it.

## Crates

| Crate | What it is |
| --- | --- |
| [`agent_correlation`](agent_correlation/AGENTS.md) | Attribution of work to the code-mode invocation (agent session) and/or the routine run that caused it. |
| `broadcast` |  |
| `database_env_vars` |  |
| `decode_jwt` |  |
| `ensure_exists` |  |
| [`feature_flags`](feature_flags/AGENTS.md) | Shared infrastructure for cross-feature rollout gating: async flag loading for the authenticated Macro user, where one load returns a stable `FlagSnapshot`, read … |
| [`genai_telemetry`](genai_telemetry/AGENTS.md) | Supports the agent sessions feature's observability: adds `gen_ai.*` content/tool-definition attributes that Datadog LLM Observability needs on top of the structural … |
| `ip_extractor` |  |
| [`kafka_util`](kafka_util/AGENTS.md) | Shared environment-aware Kafka transports: plaintext locally, MSK IAM in hosted environments, with trace propagation and typed grouped/ungrouped consumers. |
| [`macro_auth`](macro_auth/AGENTS.md) | Belongs to shared infrastructure: low-level JWT and internal-credential primitives used across services — decoding Macro API tokens, validating the internal API key, and … |
| [`macro_authorization`](macro_authorization/AGENTS.md) | Belongs to shared infrastructure: transport-independent authorization used by nearly every authenticated service. |
| `macro_axum_utils` |  |
| `macro_config` |  |
| `macro_config_derive` |  |
| `macro_cors` |  |
| [`macro_entrypoint`](macro_entrypoint/AGENTS.md) | Belongs to shared infrastructure: standardized binary initialization — tracing/logging/OTel setup and graceful shutdown — used as the first thing nearly every Rust … |
| `macro_env` |  |
| `macro_env_var` |  |
| [`macro_event_broker`](macro_event_broker/AGENTS.md) | Belongs to shared infrastructure: a Kafka-backed event broker, ports-and-adapters style, giving services a typed publish/consume API over Macro's event topics. |
| `macro_event_topics` |  |
| [`macro_middleware`](macro_middleware/AGENTS.md) | Belongs to shared infrastructure: a small grab bag of Axum middleware shared by several services, each piece gated behind its own Cargo feature. |
| `macro_queues` |  |
| [`macro_service_urls`](macro_service_urls/AGENTS.md) | Shared infrastructure: re-exports every typed Macro service URL from its own crate in `crates/platform/service_urls/` and keeps the `ServiceUrls` collection. |
| `macro_tower_layers` |  |
| [`rate_limit`](rate_limit/AGENTS.md) | Part of shared infrastructure. |
| `readonly_pool` |  |
| `remote_env_var` |  |
| `serde_utils` |  |
| [`stream`](stream/AGENTS.md) | Shared infrastructure — a Redis Streams abstraction (typed append/read/ack over `model_entity` payloads) for services that want an ordered, consumer-group event log … |
| [`upstream_error`](upstream_error/AGENTS.md) | Shared classification for failures of third-party services (GitHub, FusionAuth, ...) so they reach clients as 502/503 with a message the user can act on, instead of a … |

## Recipes

- Add a crate here: create `crates/platform/<name>` with its own `AGENTS.md`
  (from `.agents/templates/AGENTS.md`), add it to the root `members` and run
  `cargo x deps`, which adds its `[workspace.dependencies]` entry once
  something depends on it. Add it to the table above.
