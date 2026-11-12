# crates/documents

## What it is

Documents: the document domain (blocks, uploads, conversions, sharing), collaborative surfaces, the native sync service domain (`document_sync`) and its router, static files, and Lexical mention extraction. The Cloudflare sync worker itself stays in `services/sync-service`.

Layer: `domain` in [`.config/layers.toml`](../../.config/layers.toml), which
lists what this group may depend on. `cargo x deps` reports edges that break it.

## Crates

| Crate | What it is |
| --- | --- |
| [`collab_surface`](collab_surface/AGENTS.md) | Part of Documents (and other features that embed collaborative markdown): stable ids for arbitrary collaborative markdown surfaces, each backed by its own Loro CRDT … |
| [`documents`](documents/AGENTS.md) | The core of the Documents feature: document CRUD, content storage, AI editing/tools, and file-type-specific services (spreadsheets, presentations, word docs … |
| `lexical_mention_extractor` |  |
| [`document_sync`](document_sync/AGENTS.md) | Part of the Documents (collaborative editing/sync) feature — a hex crate defining the sync service's domain ports and an axum router shim, used by … |
| [`document_sync_router`](document_sync_router/AGENTS.md) | Document sync routing library hosted by DSS at `/sync/ws`. |
| [`static_file`](static_file/AGENTS.md) | Shared infrastructure for attachments and uploads — a hex crate for resolving static file (SFS) references into URLs or metadata without callers depending on … |

## Recipes

- Add a crate here: create `crates/documents/<name>` with its own `AGENTS.md`
  (from `.agents/templates/AGENTS.md`), add it to the root `members` and run
  `cargo x deps`, which adds its `[workspace.dependencies]` entry once
  something depends on it. Add it to the table above.
