# Implementation prompt: Macro Forms, first pass

You are implementing Macro Forms in this repository, worktree branch
`wolf/macro-forms`, already fast-forwarded to `main` after the databases
merge (#7353). Read, in this order, before writing any code:

1. `CLAUDE.md`, `docs/STYLE_GUIDE.md`, `docs/RUST_DEVELOPMENT.md`,
   `docs/DATABASE_DEVELOPMENT.md`, `apps/web/AGENTS.md`.
2. `docs/design/forms/README.md`, then RFCs 01, 02, 03 in that folder. They
   are decisions, not suggestions. Do not reopen a decision; if one is
   impossible as written, stop and report why with the specific code that
   blocks it.
3. The databases code you are modelling on: `crates/models_databases`
   (`ops.rs`, `views.rs`, `ids.rs`), `crates/databases` (`domain/ports.rs`,
   `domain/service.rs`, `domain/service/ops.rs`, `domain/receipt.rs`,
   `domain/entity_mutation.rs`, `inbound/axum_router.rs`, `wiring.rs`,
   `domain/service/test.rs` with its fakes), `crates/databases_sql/src/ops_sink.rs`
   (the precedent for another crate writing rows through `apply_ops`),
   `crates/entity_access/src/outbound/pg_access_repo/queries/{database_access,document_access}.rs`,
   `crates/entity_access/src/inbound/axum_extractors/database.rs`,
   `services/document_storage_service/src/main.rs` around lines 1430-1460 and
   1760-1860, `services/document_storage_service/src/api.rs` around line 266,
   `services/document_storage_service/src/service/entity_mutation.rs`.
4. On the web: `apps/web/src/features/block-database/` (definition, Block,
   TopBar, `component/DatabaseGrid.tsx`, `core/views.ts`),
   `apps/web/src/lib/queries/storage/{databases,databases-sync}.ts`,
   `apps/web/src/lib/service-clients/service-storage/{databases,itemType,client}.ts`,
   `apps/web/src/lib/core/component/LexicalMarkdown/component/decorator/{DocumentMention,DocumentCard}.tsx`,
   `apps/web/src/lib/core/messages/configured-message-editor.ts`,
   `apps/web/src/lib/core/component/TopBar/ShareButton.tsx`,
   `apps/web/src/features/command/Launcher.tsx`, and git commit `1d45bd58f9`
   (pptx) as the most recent "add a new block kind" diff.

## Conventions that are not negotiable

- Rust: hexagonal. `forms` depends on `databases` through its domain ports
  and models only. Never import another crate's `outbound`. Load config
  through `macro_env_var` / `macro_config`. Real id newtypes, never
  `type X = Uuid`. No silent fallbacks: one source of truth, fail loudly.
  `nom` for any parsing, `strum` for enum string forms. Descriptive generic
  names (`Repository`, `Databases`), never single letters. No abbreviations
  in identifiers.
- Tests first. Write the end-to-end domain test described in RFC 01 §11
  before the service exists, run it red against stubs, then implement. Never
  spin-poll async state in tests; use a real synchronisation primitive. No
  helper DSLs in tests: the first test of each kind is one full explicit
  literal.
- TypeScript: no `any`, ever, even next to code that uses it. `ts-pattern`
  `match().exhaustive()` instead of `switch`. Biome, not Prettier (`biome
  format --write`). Feature flags through `defineFlag` and the three readers.
- Migrations only through `sqlx migrate add --source
  crates/macro_db_client/migrations <name>`. Never hand-edit `.sqlx/*.json`;
  refresh the cache with `nix develop --command just prepare_db` from the
  root. Run `cargo test -p <crate>` with `SQLX_OFFLINE` unset. Run cargo with
  `TMPDIR=/home/wolf/tmp`.
- Before every push: `cargo fmt --all -- --check`, `cargo x kafka-topics
  --check`, `just check`, and the affected crates' and packages' tests.
- Never deploy anything. Never reset a database or wipe stack volumes.
- Use `\cd` instead of `cd`.

## Deliver as a stack of PRs, in this order

Each PR is reviewable alone, green on CI, with its own tests, and names the
RFC section it implements in the description. Push only to branches
prefixed `wolf/forms-`.

1. **`wolf/forms-models`**: `crates/models_forms` (ids, layout types,
   `Submission`, `SubmissionOutcome`, `FormDetail`, errors) and the pure gate
   evaluator `models_databases::views::eval` with table-driven tests covering
   every `FilterTest` variant against present, absent and `Clear` cells.
2. **`wolf/forms-entity`**: `EntityType::Form` in `crates/model-entity` and
   every arm that `Database` has (grep `EntityType::Database` across
   `crates/` and `services/`; the backend survey's list is: entity_access
   service and repos, explain repo, extractors, `entity_access_db_utils`,
   `channels` reference share, `macro_db_client` item_access delete,
   `graphql_common`, property filters, properties model and extract and
   permission queries, activity repo, favorites, soup, `soup_realtime`,
   `document_storage_service` entity_mutation). The migration from RFC 01
   §2. `form_access.rs` with the public arm, `check_public_access` arm, the
   derived database-edit arm in `database_access.rs` and
   `list_database_access`, the `ViaForm` explanation, and
   `FormAccessLevelExtractor`. `#[sqlx::test]` coverage for each access arm.
3. **`wolf/forms-domain`**: `crates/forms` domain, ports, service, Postgres
   repo, the two `DatabasesService` reads from RFC 01 §8, events and topic
   registration, activity, entity-mutation capabilities. The fake-port test
   suite. No HTTP yet.
4. **`wolf/forms-http`**: the axum router (RFC 01 §10), wiring in
   `document_storage_service`, router tests, OpenAPI (`just gen-api
   cloud-storage`), `packages/sdk` coverage (`add-sdk-endpoint` skill, wrap
   or record as skipped).
5. **`wolf/forms-web-entity`**: web registration of the `form` block, flag,
   client, hooks, create menu, icon, item type, previews, Drive and Quick
   Access entries, share modal branch with the audience panel, the
   database-side "Forms" chip and "+ view → Form". Form page with tabs
   rendering a read-only summary; no builder yet.
6. **`wolf/forms-web-builder`**: RFC 02 §3 in full.
7. **`wolf/forms-web-respond`**: RFC 02 §4 and §5, including the public
   top-level route and the Responses tab with the embedded grid. Agent guide
   page. Proof video via the `record-proof` skill.
8. **`wolf/forms-channels`**: RFC 03: mention, card body, view-only
   reference grant, `/poll` and `/form` actions, poll renderer and tally.

Rebase each PR onto the previous one's head. If a later PR needs something
missing from an earlier one, add it to the earlier PR, not around it.

## How to work

- For each PR, first write a short plan in the PR description with the
  files you will touch, then write the tests, then implement.
- When you need to see the app, use your own headless Playwright Chromium
  against a local stack (`just run_local`), never the shared Chrome on
  `:9222`. Make a worktree database (`macrodb_<worktree>`) if the shared
  local database drifts.
- Delegate parallel implementation to Opus agents only with disjoint file
  sets and an explicit contract; integrate yourself.
- Report what you tested and any check the environment blocked. If the
  databases service refuses something the RFC assumed (for example deleting
  a table's last column), do what RFC 01 says for that case and note it.
- Stop and ask only when a decision is genuinely not in the RFCs and the
  readings would produce materially different code.
