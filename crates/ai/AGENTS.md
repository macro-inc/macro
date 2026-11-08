# crates/ai

## What it is

AI building blocks: the LLM loop (`agent`), the AI tool registry and toolsets, AI projections, attachments, embeddings, image generation, yes/no classification (`jev_classifier`), memory, MCP selection and toolsets, Pipedream MCP, universal input, dictation and web search.

Layer: `domain` in [`.config/layers.toml`](../../.config/layers.toml), which
lists what this group may depend on. `cargo x deps` reports edges that break it.

## Crates

| Crate | What it is |
| --- | --- |
| [`agent`](agent/AGENTS.md) | Part of AI: the model-agnostic turn runner every AI surface in the product builds on — agent sessions, document AI, and background AI features all run a turn through … |
| [`ai_projections`](ai_projections/AGENTS.md) | Part of AI: materialized, cached AI-generated views of a user's data (for example a dashboard widget), keyed by a frontend-defined id and regenerated on demand or when … |
| [`ai_tools`](ai_tools/AGENTS.md) | Part of AI: assembles every domain crate's AI tool implementations into the one `AsyncToolCollection` every AI surface (chat, agent sessions, MCP) calls through, plus … |
| [`ai_toolset`](ai_toolset/AGENTS.md) | Part of AI: the framework underneath every AI tool in the product — the `AsyncTool` trait, JSON schema generation via `schemars`, per-tool context extraction, and … |
| [`attachment`](attachment/AGENTS.md) | Part of AI: the shared contract for turning a reference to any entity (a document, a channel message, a calendar event) into AI-consumable content, so AI tools and … |
| [`cognition`](cognition/AGENTS.md) | Shared AI generation and named yes/no decisions, exposed as a typed internal client and optional tool adapters. |
| [`dictation`](dictation/AGENTS.md) | Backs voice dictation in document and chat composers: private, transient audio transcription that validates a recording, transcribes it via Whisper, and returns text — … |
| `embedding` |  |
| [`image_generation`](image_generation/AGENTS.md) | Belongs to AI tools: generates images from a prompt (with up to three reference images), stores them as static files, and exposes the flow through an AI toolset … |
| [`jev_classifier`](jev_classifier/AGENTS.md) | Belongs to automations: yes/no classification of arbitrary JSON against a list of questions, backed by a System One decision model (TypeSafe's Jev or Cloudflare Workers … |
| `mcp_select` |  |
| [`mcp_toolset`](mcp_toolset/AGENTS.md) | Part of agent sessions / AI tooling. |
| [`memory`](memory/AGENTS.md) | Owns composed AI memory: private explicit preferences, privacy-reviewed professional profiles, and daily activity rolled into calendar weeks, months, and a long-term … |
| [`pipedream_mcp`](pipedream_mcp/AGENTS.md) | Part of the AI agent tools feature. |
| [`universal_input`](universal_input/AGENTS.md) |  |
| [`web_search`](web_search/AGENTS.md) | Part of AI tools: web search and page fetch for every agent and the SDK. |

## Recipes

- Add a crate here: create `crates/ai/<name>` with its own `AGENTS.md`
  (from `.agents/templates/AGENTS.md`), add it to the root `members` and run
  `cargo x deps`, which adds its `[workspace.dependencies]` entry once
  something depends on it. Add it to the table above.
