# crates/databases

## What it is

Databases and their neighbours: the database domain, the SQL engine (`database_sql`, also built to wasm for the browser) and its Postgres runner (`databases_sql`), webhooks, forms, custom properties and system properties, saved views, and CRM, which is built on databases.

Layer: `domain` in [`.config/layers.toml`](../../.config/layers.toml), which
lists what this group may depend on. `cargo x deps` reports edges that break it.

## Crates

| Crate | What it is |
| --- | --- |
| [`crm`](crm/AGENTS.md) | Part of CRM (Sales): a hexagonal crate for companies, contacts, and pipelines (including the legacy-CRM → Sales migration), plus the AI tools/HTTP/GraphQL surfaces over … |
| [`database_sql`](database_sql/AGENTS.md) | Part of the Databases feature: the SQL subset agents and the console use to read and write Macro databases. |
| `database_webhooks` |  |
| [`databases`](databases/AGENTS.md) | The core of the Databases feature (also underlies CRM and Forms storage): tables of typed rows whose cells are entity properties, behind a hexagonal service with Axum … |
| [`databases_sql`](databases_sql/AGENTS.md) | Part of the Databases feature: runs the `database_sql` engine over Macro databases for agents and authenticated HTTP clients, alongside the browser's direct … |
| [`forms`](forms/AGENTS.md) | Backs the Forms feature: questionnaires that are views of a database table. |
| [`properties`](properties/AGENTS.md) | Part of the Databases and CRM features. |
| [`properties_inbound`](properties_inbound/AGENTS.md) | Part of the Databases and CRM features: the Properties HTTP API (feature `axum`: routes, router state, OpenAPI paths) and the AI property/tag toolset (feature … |
| [`properties_service`](properties_service/AGENTS.md) | Part of the Databases and CRM features. |
| [`saved_views`](saved_views/AGENTS.md) |  |
| [`system_properties`](system_properties/AGENTS.md) | Part of the shared properties feature — database operations for system-managed properties: predefined properties (e.g. |

## Recipes

- Add a crate here: create `crates/databases/<name>` with its own `AGENTS.md`
  (from `.agents/templates/AGENTS.md`), add it to the root `members` and run
  `cargo x deps`, which adds its `[workspace.dependencies]` entry once
  something depends on it. Add it to the table above.
