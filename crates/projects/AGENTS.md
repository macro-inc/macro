# crates/projects

## What it is

Projects and folders: `initiative` (the product's projects: named groups of tasks) and its description surface, `projects` (folder organization in Drive), and task deduplication.

Layer: `domain` in [`.config/layers.toml`](../../.config/layers.toml), which
lists what this group may depend on. `cargo x deps` reports edges that break it.

## Crates

| Crate | What it is |
| --- | --- |
| [`initiative`](initiative/AGENTS.md) | Belongs to tasks/project management: initiatives are a named grouping of tasks. |
| `initiative_description` |  |
| [`projects`](projects/AGENTS.md) | Part of the Projects feature (folder organization for documents and other entities). |
| [`task_dedup`](task_dedup/AGENTS.md) | Part of the Projects/Tasks feature — detects duplicate tasks by embedding a task, searching a pgvector corpus, and judging candidate duplicates with an LLM. |

## Recipes

- Add a crate here: create `crates/projects/<name>` with its own `AGENTS.md`
  (from `.agents/templates/AGENTS.md`), add it to the root `members` and run
  `cargo x deps`, which adds its `[workspace.dependencies]` entry once
  something depends on it. Add it to the table above.
