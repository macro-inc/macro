# Magic tables

Magic tables expose Macro's own data to SQL: `people`, `documents`, `tasks`, `companies`,
`calls`, `email_threads`, `channels`, `calendar_events`, `projects`. None of them exist as
stored tables anywhere. Each is a **contract**: a name, a column list, and one blessed,
permission-filtered Postgres query that can produce it for a given user on demand.

They're what makes user tables join against the platform:

```sql
SELECT p.email
FROM   guests g
JOIN   people p ON p.id = g.guest      -- people: magic table, every contact you can see
WHERE  g.status = 'Going'
```

## How a magic table gets into a query

1. Its schema is always present in the prepare catalog (columns declared, no data).
2. The authorizer reports it referenced — **with columns**, e.g. `people(id, email)`.
3. Its blessed query runs scoped to the requesting user, projected to only the referenced
   columns, and bulk-inserts into the scratch SQLite.
4. The join is then an ordinary SQLite join: cell ids and magic-table `id` columns are the
   same id space (typed prefixes: `usr_`, `doc_`, `call_`…).

Column-level laziness is the key affordance: heavy fields (`documents.content_md`,
`calls.transcript`) can be real columns whose cost is only paid when a query names them.

## Column contracts (initial sketch)

Every magic table = system fields + the entity's system/shared property definitions
(materialized from `entity_properties`). Adding a workspace property "Region" to companies
makes `companies.region` appear in SQL for free.

| table | system columns (beyond id, created_at) | heavy/lazy columns |
|---|---|---|
| `people` | name, email, org, is_team_member | — |
| `documents` | title, owner_id, project_id, updated_at | content_md |
| `tasks` | title, status, assignee, due_date (system props) | — |
| `companies` | name, domain + CRM system props | — |
| `calls` | title, started_at, duration, participants (junction) | transcript, summary |
| `email_threads` | subject, participants (junction), last_message_at | — |
| `channels` | name, member_count | — |
| `calendar_events` | title, starts_at, ends_at, attendees (junction) | — |
| `projects` | name | — |

Multi-valued fields (call participants, event attendees) materialize as junction views
(`calls__participants(call_id, user_id)`), same pattern as user-table multi columns.

Blessed-query sources: ContactsDB for `people` (contacts + team members the user can see),
`entity_access`-filtered MacroDB queries for the rest. Each contract lives next to its
domain crate; the databases crate defines the trait
(`fn schema() -> TableSchema; async fn materialize(user, columns) -> Rows`).

## Permission scoping

The blessed query IS the permission check. A viewer's scratch DB only ever contains
entities they can access, so joins silently drop what they can't see. No filtering inside
user SQL, no way to leak by clever query construction — the data was never materialized.

## Read-only

`UPDATE people SET ...` is rejected at the authorizer with a pointer to the SDK
(`macro.contacts.update(...)`). Write-through for clean-provenance columns is a possible
later tier, same traceability rule as updatable views.

## Relationship to properties

`entity_properties` is what makes magic tables rich: `tasks.due_date` exists because "Due
date" is a system property. The materializer for property-backed columns is one shared
implementation (pivot the EAV rows for the referenced definitions), reused by every magic
table.

## Liveness tier

Magic-table dependencies get the weak tier first: re-run on mount + window focus (staleness
of seconds, invisible for a contact rename). Coarse version signals per magic table are v2
if usage demands. See [liveness.md](liveness.md).
