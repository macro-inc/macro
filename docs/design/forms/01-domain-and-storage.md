# RFC 01: Forms domain and storage

Status: accepted for the first pass. Decisions here are made; where a
decision was close, the alternative and the reason it lost are noted so the
question is not reopened by accident.

## 1. Shape

Two crates, laid out like `crates/models_databases` and `crates/databases`:

- `crates/models_forms`: wire types shared by the service, the web client and
  the SDK. Ids, the form layout, answers, submission outcomes. Derives
  `serde`, `utoipa::ToSchema`, `specta::Type` like `models_databases`.
- `crates/forms`: the hexagonal crate. `domain` (models, ports, service,
  events, activity, entity_mutation), `inbound/axum_router`, `outbound`
  (Postgres repo, gateway publisher), `wiring.rs`. Feature flags mirror
  `crates/databases/Cargo.toml`: `ports`, `outbound`, `postgres`, `inbound`,
  `entity_mutation`, `gateway`.

`forms` depends on `databases` through its domain only: the `DatabasesService`
port and `databases::domain::models`. It never imports `databases::outbound`.
Both services are built in the same composition root,
`services/document_storage_service/src/main.rs`, and `forms::wiring::build_service`
takes the already-built databases service as an argument.

Ids are newtypes: `FormId`, `FormSectionId`, `FormQuestionId`,
`FormResponseId`. `models_databases` keeps its `database_id!` macro private;
copy the macro into `models_forms::ids` rather than making a shared crate for
ten lines. Same UUIDv7 minting, same transparent serde and schema.

## 2. Tables

One migration, generated with `sqlx migrate add --source
crates/macro_db_client/migrations add_forms`. Fractional positions follow the
databases convention (`TEXT COLLATE "C"`, keys from
`models_databases::position`).

```sql
CREATE TABLE forms (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    owner_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
    -- The table whose rows are the responses. Purging either removes the form.
    database_id UUID NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
    table_id UUID NOT NULL REFERENCES database_tables(id) ON DELETE CASCADE,
    -- Columns the form writes itself. Deleting one in the grid just stops that write.
    submitted_column_id UUID REFERENCES database_columns(id) ON DELETE SET NULL,
    respondent_column_id UUID REFERENCES database_columns(id) ON DELETE SET NULL,
    -- 'members': signed-in Macro users, one response each.
    -- 'public': anyone with the link, anonymous, no uniqueness.
    audience TEXT NOT NULL DEFAULT 'members' CHECK (audience IN ('members', 'public')),
    -- Whether respondents may see option tallies (polls).
    tally_visible BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    closes_at TIMESTAMPTZ,
    confirmation_message TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    trashed_at TIMESTAMPTZ
);
CREATE INDEX idx_forms_owner ON forms(owner_id);
CREATE INDEX idx_forms_table ON forms(table_id);

CREATE TABLE form_sections (
    id UUID PRIMARY KEY,
    form_id UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
    position TEXT COLLATE "C" NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL CHECK (kind IN ('questions', 'gate')),
    -- A gate's rules: models_databases::views::FilterGroup as JSON. Columns it
    -- names must be questions of earlier sections.
    gate_rules JSONB CHECK (gate_rules IS NULL OR jsonb_typeof(gate_rules) = 'object'),
    gate_message TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_form_sections_form ON form_sections(form_id, position);

CREATE TABLE form_questions (
    id UUID PRIMARY KEY,
    form_id UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
    section_id UUID NOT NULL REFERENCES form_sections(id) ON DELETE CASCADE,
    -- The column this question writes. Deleting the column deletes the question.
    column_id UUID NOT NULL REFERENCES database_columns(id) ON DELETE CASCADE,
    position TEXT COLLATE "C" NOT NULL,
    help_text TEXT NOT NULL DEFAULT '',
    required BOOLEAN NOT NULL DEFAULT FALSE,
    -- Presentation only: how the column's type is asked. See §4.
    widget TEXT,
    UNIQUE (form_id, column_id)
);
CREATE INDEX idx_form_questions_section ON form_questions(section_id, position);

-- The submission ledger. Answers live in the table; this is who answered,
-- when, and whether a gate stopped them.
CREATE TABLE form_responses (
    id UUID PRIMARY KEY,
    form_id UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
    respondent_id TEXT REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE,
    -- The row the answers were written to. A row deleted in the grid leaves
    -- the ledger entry, with no row.
    row_id UUID REFERENCES database_rows(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('submitted', 'stopped')),
    stopped_at_section UUID,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One response per signed-in person. Anonymous responses are unbounded.
CREATE UNIQUE INDEX form_responses_one_per_person
    ON form_responses (form_id, respondent_id) WHERE respondent_id IS NOT NULL;
CREATE INDEX idx_form_responses_form ON form_responses(form_id, status);
```

Why the ledger exists at all: one-per-person must not depend on cells, since
an editor can change or clear the Respondent cell in the grid. "Stopped at
gate" has no row to live on. And the Responses tab's counts come from here.

Why `database_id` and `table_id` cascade: a form whose table is gone has
nothing to write to. The grid's delete-table confirmation names the forms
that go with it (RFC 02 §7). Trashing a database does not touch forms; a form
over a trashed database refuses submissions with `FormError::TableGone` and
the builder shows it.

## 3. The form as a view of the table

The table is the schema. The form has no question that is not a column, and
reading a form means joining `form_questions` to the table's columns through
`DatabasesService::get_database`, which already answers tables, columns,
kinds and options in one call.

What the form owns per question: section, position, help text, required,
widget. What the column owns: title (`display_name`), type (`ColumnKind`),
options. Editing a title, type or option in the builder is a `DatabaseOp`
batch on `POST /databases/{id}/ops`, sent by the web client exactly as the
grid sends it. The forms service does not proxy schema edits.

Adding a question: the client mints a `ColumnId`, posts
`Column { change: Create { definition: New { name, kind, options } } }`, then
puts the form layout with the new column id in a section. If the second call
fails the column exists and is simply not on the form; the builder lists it
under hidden columns, nothing is lost.

Removing a question: the default is removing it from the layout. The column
stays. Deleting the column is the grid's own destructive action, offered in
the builder under a separate item with the row count, and it goes through the
same `ColumnChange::Delete` op with the same confirmation.

Changing a question's type with responses present: `ColumnChange::ChangeType`
refuses misfits. The builder surfaces the refusal and offers "Convert into a
new question", which is the grid's `column_conversion` flow followed by a
layout put that swaps the column id. No new behavior in the service.

### Managed columns

When a form attaches to a table (either door in §6) the service makes sure
the table has two columns it will write on every submission:

- `Submitted`, `ColumnKind::Date`
- `Respondent`, `ColumnKind::Entity { target: User, multi: false }`

It looks for existing columns by name and kind first and reuses them, so two
forms over one table share them. It records their ids on the form. They are
never questions. If someone deletes one in the grid, the foreign key nulls the
id and the form stops writing that cell; the ledger still has the data. A column retyped away from its managed kind also stops receiving that metadata; the ledger remains authoritative.

## 4. Widgets: how a column kind is asked

`form_questions.widget` is optional and only narrows how the column is
presented. The service validates the pair; anything else is refused with
`FormError::WidgetMismatch`.

| ColumnKind | widget (default first) | Asked as |
| --- | --- | --- |
| Text | `short`, `paragraph` | one-line input, textarea |
| Number | none | numeric input |
| Boolean | none | single checkbox |
| Date | `datetime`, `date` | date-time picker, date picker |
| Link | `url`, `file` | URL field, file upload (stores the static-file permalink) |
| Select single | `choice`, `dropdown` | radio list, dropdown |
| Select multi | `checkboxes` | checkbox list |
| SelectNumber | `dropdown` | dropdown of numbers |
| Tag | `checkboxes` | checkbox list |
| Entity | none | picker for the target kind (people, documents, …) |
| Relation | none | picker over the related table's rows (title column) |

`file` is refused while `audience = 'public'`, and setting the audience to
public is refused while a `file` question exists
(`FormError::FileUploadNeedsSignIn`). Anonymous upload does not exist in the
static file service and we are not building it in this pass.

## 5. Access

`EntityType::Form` is added to `crates/model-entity`. Follow every arm that
`Database` touched (the list is in the implementation prompt); the ones that
differ:

- `is_valid_entity_access_entity`: `false`, like `Database`.
- `entity_access/src/outbound/pg_access_repo/queries/form_access.rs`: the
  highest level from `entity_access WHERE entity_type = 'form' AND source_id =
  ANY($2)`, plus a public arm: `View` when `forms.audience = 'public'` and the
  form is not trashed. With empty source ids only the public arm runs, which
  is how `DocumentAccessExtractor` serves anonymous readers today. `check_public_access`
  gets a `Form` arm with the same rule.
- A new `FormAccessLevelExtractor` modelled on
  `axum_extractors/database.rs`, except a request with no user asks the public
  arm and, if it answers `View`, yields a receipt with
  `EntityAccessAuth::Unauthenticated`. Edit and Owner requirements can never be
  met anonymously because the public arm only ever answers `View`.
- Sharing: `GET` and `PATCH /forms/{id}/permissions` are the database ones
  verbatim (`SharePermissionV2`, channel grants through
  `update_entity_access_channel_share_permissions`), owner only. Audience is
  not a share permission; it is `PATCH /forms/{id}` and owner only.

What each level means on a form, which the UI copy must say: view = can
respond, edit = can change questions and read responses, owner = can also
change audience, close, trash. Posting a form into a channel grants view (RFC
03 §2). Because editing questions uses the database schema, edit also grants
full database Edit, including changing response rows and other columns. The
share dialog must disclose this; grant edit only to trusted collaborators.

### Derived database access

A form's editors must read its responses, which are rows of the database.
Grants are not mirrored. Instead `queries/database_access.rs` and
`list_database_access` get one more arm:

```sql
-- Edit on a database follows edit or owner on any form over it.
SELECT 'edit' FROM forms f
JOIN entity_access ea ON ea.entity_id = f.id AND ea.entity_type = 'form'
WHERE f.database_id = $1 AND f.trashed_at IS NULL
  AND ea.source_id = ANY($2) AND ea.access_level IN ('edit', 'owner')
```

The access explanation (`pg_explain_access_repo`) gets a matching
`AccessGrant::ViaForm { form_id }` so the share dialog can say "editor of Q4
offsite RSVP". View on a form grants nothing on the database; respondents
never see rows.

## 6. Creating a form

`POST /forms` with `CreateForm { name, source }`:

- `source: New`: calls `DatabasesService::create_database(CreateDatabase {
  name, owner_id, acting_bot })` for the caller, then one ops batch under an
  internal receipt: rename `Table 1` to `Responses`, create the two managed
  columns, delete the starter `Name` column if the service allows deleting it
  (a table with no columns is fine for databases; if that rule turns out to
  differ, keep `Name` off the layout instead). The form starts with one empty
  `questions` section.
- `source: Table { database_id, table_id }`: requires Owner on the database.
  This prevents an editor from creating an owned form whose derived database
  Edit would survive revocation of the original grant.
  Managed columns are found or created. One section is made holding a question
  per existing column in column order, excluding the managed ones, each with
  the default widget.

Either way the form's owner is the caller and the response is `FormDetail`.
Names are independent after creation: renaming the form never renames the
database, and the reverse.

Trashing a form never trashes the database. Restoring works as for
databases. Permanent delete removes the form and its ledger only. All four
go through the unified entity-mutation router by implementing the
`entity_mutation` capability traits as `databases::domain::entity_mutation`
does; `services/document_storage_service/src/service/entity_mutation.rs`
gets a `Form` arm.

## 7. Submitting

`POST /forms/{id}/responses` with `Submission { answers: Vec<Answer> }` where
`Answer { question: FormQuestionId, value: CellValue }` reuses
`models_databases::CellValue` unchanged, so option ids, entity refs and
relation rows are already typed. The receipt is `View`, authenticated or
public.

The service, in order:

1. Load the form, its layout, and the table schema through
   `DatabasesService::get_database` under an internal view receipt on the
   database (`EntityAccessReceipt::dangerously_assert_internal_user`; this is
   the sanctioned case: the forms service is doing the authorization). Refuse
   if `status = closed`, `closes_at` has passed, the table is gone, or the
   audience is `members` and the receipt is unauthenticated.
2. Refuse a signed-in caller whose ledger already holds a submitted response
   before inserting another row (`AlreadyResponded`; edits use PUT). Validate
   that every supplied answer names a question of this form and has a valid
   shape. Let `apply_ops` remain the authority on cell fit; its refusals map
   to `FormError::InvalidAnswer { question }`.
3. Traverse the layout in section order. In each reached `questions` section,
   require a nonempty, non-`Clear` value for every required question. At each
   gate, evaluate against the answer map and stop immediately on failure,
   before validating required questions in later sections. The rules are a
   `FilterGroup`; add a pure evaluator `models_databases::views::eval::matches(&FilterGroup, &HashMap<ColumnId, CellValue>) -> bool`
   next to `views/check.rs`. Gates intentionally use stricter empty-answer
   semantics than database views: absent, `Clear`, blank text and empty lists
   fail every test but `IsEmpty`, including negative tests and unchecked.
   Every text operator is case-insensitive. Existing database-view filtering
   is unchanged. The first failing gate stops the submission: write a `stopped`
   ledger entry for signed-in respondents (upsert on the one-per-person key)
   and answer `SubmissionOutcome::Stopped { section, message }`. No row.
4. Build one `Rows::Insert` with the answers plus `Submitted = now` and
   `Respondent = user` when signed in and the managed columns still exist.
   Apply it with `DatabasesService::apply_ops(internal edit receipt,
   Viewer { user_id: respondent or form owner, acting_bot: None }, batch)`.
   The viewer's id becomes the row's `created_by`, so signed-in rows carry
   their author with no extra work. The journal records no actor for an
   internal receipt; acceptable for this pass.
5. Insert the ledger entry with the returned `RowId` and answer
   `SubmissionOutcome::Submitted { response, row }`. The databases write and
   the ledger write are two transactions. A ledger failure after a committed
   row is logged with the row id and surfaces as an error to the client; the
   row stays. Rare, recoverable by hand, not worth a saga. The early ledger
   check prevents sequential duplicate submissions. Concurrent submissions
   can still race: the unique ledger key accepts one, the losing request
   returns `AlreadyResponded`, and its committed row is logged and retained
   under this same failure policy. This is not a cross-service atomic write.
6. Publish `form.response_submitted` (§9).

Public audience permits anonymous access; it does not discard a signed-in
caller's identity. Signed-in responses retain the Respondent attribution,
one-per-person constraint, and ability to edit. Anonymous submissions have no
respondent and cannot be retrieved through `/responses/mine`.

Editing a response: `PUT /forms/{id}/responses/mine` for signed-in
respondents while the form is open. Same validation, gates re-run, then
`Rows::Update { PerRow }` on the ledger's row id (or an insert if the row was
deleted in the grid, with the ledger repointed). `GET
/forms/{id}/responses/mine` returns the ledger entry and the row's current
cells read through `DatabasesService::cells_of_rows` (§8).

An edit replaces the form's answers: an omitted optional answer clears that
question's cell, while columns outside the form are preserved. A rejected
edit leaves a previously submitted row and receipt unchanged; it must not
turn that accepted response into an orphan row. A first attempt, or retry of
a stopped response, can record a stopped ledger entry as described above.

## 8. Reads the service needs from databases

Two small additions to the `DatabasesService` port, both plain reads over
existing `CellStore` methods, so forms never touches a databases outbound
adapter:

- `cells_of_rows(receipt: View, table_id, rows: &[RowId]) -> HashMap<RowId, Vec<CellWrite>>`
  for "my response".
- `column_cells(receipt: View, table_id, column_id) -> HashMap<RowId, CellValue>`
  for tallies.

`GET /forms/{id}/responses/summary` (edit): counts from the ledger
(`submitted`, `stopped` by section) plus the table's row count.

`GET /forms/{id}/tally` (view, only when `tally_visible`): for every Select,
SelectNumber, Tag and Boolean question, option counts computed in memory from
`column_cells`. This is what a poll renders for respondents, who cannot read
the table.

## 9. Events and liveness

Topic `macro.forms` registered in `crates/macro_event_topics`, regenerated
with `cargo x kafka-topics`. Events, shaped like `DatabaseTopicEvent`:
`form.created`, `form.renamed`, `form.trashed`, `form.restored`,
`form.purged`, `form.sharing_changed`, `form.response_submitted { form,
response, respondent: Option<user>, row: Option<row> }`.

Activity (`forms::domain::activity`): created, renamed, and "responded",
attributed to the respondent when signed in. The Responses grid needs no new
liveness work: `apply_ops` already publishes `database_table_changed` for the
table, and the embedded grid is subscribed to it like any other.

The builder is single-editor in practice; no awareness relay in this pass.

## 10. Routes

Mounted at `/forms` in `services/document_storage_service/src/api.rs` next to
`/databases`, state built like `DatabasesRouterState`.

| Route | Receipt | Does |
| --- | --- | --- |
| `POST /forms` | user | §6 |
| `GET /forms?databaseId=` | view on database | forms over that database, for the grid's chip |
| `GET /forms/accessible` | user | live forms granted to this caller, including channel/team grants, with each access level; powers Drive and Quick Access without database access |
| `GET /forms/{id}` | view, public ok | `FormDetail`: form, sections, questions joined with column name, kind, options; never rows |
| `PATCH /forms/{id}` | edit; audience, status, closes_at, tally_visible need owner | metadata |
| `PUT /forms/{id}/layout` | edit | replace sections and questions atomically; validates columns belong to the table, widgets fit, gates name earlier columns, every question's section exists |
| `POST /forms/{id}/responses` | view, public ok | §7 |
| `GET /forms/{id}/responses/mine` | view, signed in | own ledger entry and cells |
| `PUT /forms/{id}/responses/mine` | view, signed in | §7 |
| `GET /forms/{id}/responses/summary` | edit | counts |
| `GET /forms/{id}/tally` | view | §8 |
| `GET` / `PATCH /forms/{id}/permissions` | owner | sharing |

Rename, trash, restore and permanent delete come through the unified entity
mutation router, not here. `PUT /layout` is one document on purpose: the
builder autosaves the whole layout and the service validates it as a whole.
Per-question CRUD would need its own ordering rules and gains nothing.

## 11. Tests

Copy the databases shape: `forms/src/domain/service/test.rs` over in-memory
fakes for the forms repo and a fake `DatabasesService` that records ops, with
the `OWNER`, `EDITOR`, `VIEWER`, `STRANGER`, and anonymous receipts. Router
tests with `tower::ServiceExt::oneshot` asserting 401 for anonymous
submissions on a members form and 200 on a public one. `#[sqlx::test(migrator
= "MACRO_DB_MIGRATIONS")]` tests for the repo, the access query arms (public,
derived database edit), and the one-per-person index. One end-to-end domain
test, written first and run red, that creates a form from a new database,
puts a layout with a gate, submits a passing and a failing response, and
checks the ops the fake databases service received.

## 12. Out of scope, decided

- Branching between sections, calendar questions, server drafts, anonymous
  response editing, AI tools: see the README.
- A "Form" entity kind for `ColumnKind::Entity`: a column pointing at forms.
  Nobody asked for it.
- Cascading trash from a form to the database it created. Data never goes
  with a form.
