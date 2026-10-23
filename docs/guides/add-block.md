# Adding a block

Blocks are a legacy pattern we live with (FE-47). A block is a thin shell: a
`definition.ts` that registers and lazy-loads, and an adapter that translates
block state once. Everything else is an ordinary layered feature that works
without a block.

A block is the web app's viewer or editor for one file type or entity:
`apps/web/src/features/block-<name>/`, mounted by the block loader whenever a
split opens `<name>/<id>`. A new block touches a dozen or more places across
the web app, the file-type and entity models, search, AI tools, and the build.
Each section below is one of them, in the order you reach them. The lessons from
past launches and their follow-up fixes are called out inline.

## Pick a model to copy

| Building | Copy | Why |
| --- | --- | --- |
| Editor for a file type with a Rust engine | `block-psd` + `crates/psd_engine` + `apps/web/src/lib/core/psd-engine` | Newest full example: layered feature, worker-hosted wasm engine, feature flag, create flow, search parser, AI read tool, browser fixture |
| Editor that takes over a type that used to download | `block-pptx`, `block-write` | Flag-off path keeps download-only; `write` shows how a type switches blocks behind a flag |
| Entity that is not a document (own table and API) | `block-form` | Entity type, item type, previews, sharing, Quick Access, a public route, production composition split out (`form-context-production.tsx`) |
| Feature layering in general | `features/activity`, `block-form` | The FE-33 reference and a block that follows it end to end |

Don't copy `block-channel` or `block-pdf` ([web agent guide](../../apps/web/AGENTS.md)).
Read [FE-33 and FE-34](../../.agents/rules/web/architecture.md),
[frontend feature architecture](../architecture/frontend-features.md), and the
[startup bundle rule](../../.agents/rules/web/startup-bundle.md) before writing
the block.

**File-backed or entity-backed.** A file-backed block opens a document stored in
document storage (`source.type === 'dss'`, a `fileType`, bytes behind a
presigned URL); you add a file type and usually an engine. An entity-backed
block opens a row of its own table through its own API; you add an entity type
and none of the file-type steps. Sections 4 and 5 are one or the other.

## 1. Folder, definition, and registry

- Add the name to `BlockRegistry` in
  `apps/web/src/lib/constants/block-registry.ts`.
- Create `apps/web/src/features/block-<name>/definition.ts` exporting
  `definition = defineBlock({...})` with `name` as a string literal.
  `apps/web/src/lib/core/constant/allBlocks.ts` discovers every
  `features/*/definition.ts` with `import.meta.glob` and throws at boot on a
  name missing from the registry or defined twice; `allBlocks.test.ts` checks
  the same by reading the literal. There is no separate list of "virtual"
  blocks any more: every registry name needs a real definition.
- **`definition.ts` is eager.** The glob puts every definition in the entry
  chunk. Blocks used to import their components statically here, which put
  every block's UI in the startup bundle until a sweep made them lazy. Use
  `component: lazy(() => import('./<name>-block'))` and dynamic-import query
  modules inside `load` (`block-form/definition.ts`). A `loading` placeholder is
  allowed but must be a tiny skeleton with no editor or engine imports. Making a
  block eager is a measured trade (the agent block is eager on purpose, as the
  hot path), not a default. No test guards this; the build only fails on a
  file over 10 MB, so check the entry chunk yourself (see
  [Verify locally](#verify-locally)).
- `load(source, intent)`:
  - Return `LoadErrors.INVALID` (or `MISSING`) for sources you don't handle.
  - Answer `intent === 'preload'` before fetching bytes.
  - Load from where the bytes actually live. A stored binary uses
    `fetchBinaryDocumentData` and `fetchBinary` (`block-psd`). A file seeded
    into the sync service on first open uses `fetchFileDocumentOpenContext`
    (`block-write`). The DOCX editor first shipped with the Markdown loader,
    which requires a sync location an uploaded file doesn't have yet, and
    every upload failed to open.
  - Use the typed fetch helpers as they are. A cast hid `'arraybuffer'` versus
    `'arrayBuffer'` in the DOCX download and broke it.
  - When the block's feature flag is off, return the file with `bytes: null`
    so the block offers a download (`block-psd/definition.ts`).
  - Start the engine's wasm fetch while storage answers, except on preload
    (`block-fig/definition.ts`, `warmEngine`).
- Options: `accepted` (extension → MIME; `{}` for entities),
  `liveTrackingEnabled` (presence indicators), `editPermissionEnabled` (the
  share menu inside the block offers Edit only when set), `openTrackingEnabled`
  (defaults on and writes a history row and page view; turn it off when there
  is nothing to record, as `block-database` does), `openAnalyticsEnabled`
  (whether opens send `open_entity`; defaults to `openTrackingEnabled`, and
  `block-database` turns it back on), `defaultFilename`, `aliases`.
- Gate the block with a flag in `apps/web/src/lib/core/constant/featureFlags.ts`
  via the [feature-flags skill](../../.agents/skills/feature-flags/SKILL.md).
  `isFeatureEnabled` answers `false` until PostHog has loaded, so on a cold deep
  link a PostHog-gated block reads as off. Wait for the decision in both
  `component` and `load`, as `block-database/queries/database-rollout.ts` does.
- A lazy view inside the block needs its own `<Suspense>`. Without one the
  suspension reaches the app shell, which blanked the screen on mobile.

### Layering

New blocks use the layered structure (`core/`, `queries/`, `primitives/`,
`components/`, `views/`, `context/`), not the legacy block state system. The
one file allowed to read legacy state is the adapter, `<name>-block.tsx`: it
reads `blockDataSignal`, `useBlockId`, `useCanEdit` and friends **once** and
hands identity, permissions, and host actions to a feature context or props
(`block-psd/psd-block.tsx`, `block-form/form-block.tsx`). Never call `useBlock*`
below the adapter: components that did crashed with "must be used within a
Block component" once they were mounted outside `<Block>` (for example in
Drive's detail pane), which is what FE-34 came from.

Register the layer directories in **all eight** `rules/ast-grep/{ts,tsx}-feature-*.yml`
rules, or the layer lint never runs on them. `block-pptx`, `block-fig`, and
`block-database` are unregistered and `block-psd` is only in six; copy the
`block-form` entries.

## 2. Maps keyed by block name

With the name in `BlockRegistry`, `bun run type-check` fails until you add it to
the exhaustive maps:

- `apps/web/src/lib/core/block.ts`: `_ValidBlockCombinations` (which blocks may
  share a split) and `ValidNestingCombinations` (where it may render nested;
  `new Set([])` unless it really embeds, as form cards do in `md` and
  `channel`).
- `apps/web/src/lib/core/blockMethodRegistry.ts`: `EmptySpec` unless other code
  calls methods on the block.
- `apps/web/src/lib/core/component/EntityIcon.tsx`: `ENTITY_ICON_CONFIGS`
  (icon, bold icon, colors, `prettyName`). Lists, previews, drag images, and
  the create menus all read it.
- `apps/web/src/lib/core/component/FileList/constants.tsx`: `_fileTypeColors`.
- `apps/web/src/features/entity/utils/buildEntityData.ts`: the document arm for
  file-backed blocks, the `undefined` arm for entities that don't come from Soup.

Not type-enforced: an entity-backed block also goes in `NonDocumentBlockTypes`
in `block.ts`.

## 3. Routes and splits

- **No route to add for the block itself.** `/app/<name>/<id>` resolves through
  `legacyContentRoute` and `decodeLegacyPair`
  (`apps/web/src/components/app/split-layout/split-router/legacy-route.ts`), and
  Home's inline route takes any registered name (`homePreviewRouteParams` in
  `apps/web/src/features/home/home-route-schema.ts`, derived from
  `BlockRegistry`). Home's schema once excluded `write`, so DOCX files didn't
  open from Home; don't add per-block exclusions there.
- `apps/web/src/components/app/split-layout/componentRegistry.tsx` is for
  views (Home, Drive, Settings), not blocks. Don't register a block there.
- **Inline detail panes.** Drive and entity detail panes open a document inline
  only for the types in `entityDetailBlockType`
  (`apps/web/src/components/entity-detail/EntityDetail.tsx`) and
  `DRIVE_DOCUMENT_TYPES`
  (`apps/web/src/features/drive-view/primitives/drive-route-schema.ts`);
  everything else opens as a full block in a split. Leave a new block out
  unless you also build an inline detail view for it.
- **A standalone page** (public, outside the split layout, such as a form's
  respond link): a `defineRoute` in `apps/web/src/routes/routes.ts`, a page in
  `apps/web/src/routes/pages.tsx` that lazily imports the feature, a `lazyNamed`
  export in `apps/web/src/routes/lazy-route-views.ts`, and a `<Route>` in
  `apps/web/src/routes/app-router-view.tsx` under the shell it needs from
  `apps/web/src/routes/shells.tsx` (`withFormRespondShell` is the model). The
  shell is chosen per route now; don't match path prefixes in `Root.tsx`, as
  booking and respond links once did.
- Entity-backed: add the type to `getEntitySplitContent` in
  `apps/web/src/components/app/split-layout/components/SplitHeader.tsx` (drag
  into a split) and to `IdOnlyPreviewSelection` in
  `apps/web/src/components/app/previewTarget.ts`.

## 4. File type (file-backed blocks)

Skip this section if the type already exists in `crates/model_file_type` and
you are only giving it an editor (as `pptx` and `docx` did).

- **Backend enum.** Add a `generate_file_types!` row to
  `crates/model_file_type/src/lib.rs`: variant, extension, MIME, app category.
  Check `ContentTypeExt` in `crates/model/src/document/file_type.rs`: Photoshop
  files carry an `image/` MIME and had to be excluded from `is_image`, or image
  pipelines would try to decode them.
- **Generated clients.** The `FileType` enum reaches the storage, cognition, and
  search OpenAPI specs. Regenerate the web clients (`bun run gen-api` in
  `apps/web`) and the SDK (`just update-generated` in `packages/sdk`); CI's
  Generated Code Check fails on stale output. The `item_filters` snapshot
  `crates/item_filters/src/ast/tests/other.json` also changes with each new
  type in a category it expands.
- **Frontend mirror.** `apps/web/src/lib/service-clients/service-storage/fileTypeMap.ts`
  is a copy of the Rust enum that no codegen step refreshes. Generate the rows
  with `cargo run -p model_file_type --bin generate_typescript_types` (it
  writes `generated/fileTypeMap.ts` under the current directory) and copy the
  new ones in. Uploads resolve a missing or `application/octet-stream` content
  type from this map (`apps/web/src/lib/core/util/uploadContentType.ts`).
- **Other allowlists.** Channel attachments accept only
  `apps/web/src/features/channel/Input/accepted-file-types.ts`. Quick Access
  reads `fileType` from GraphQL; it once dropped the field, so new spreadsheets
  showed a generic icon and Cmd+K opened the wrong item. Add the type to the
  cases in `apps/web/src/lib/queries/history/tests/graphql.test.ts`.
- **`accepted`** in the definition drives `fileTypeToBlockName` and the
  upload MIME → extension lookup, where the first block to claim a MIME wins.
  Two extensions sharing one MIME (`psd`, `psb`) map back to the first.
- **Uploads.** Extensions arrive in any case (`.PSD`); uppercase extensions
  once failed uploads. Upload a real file of the type, at the size limit, from
  the drop zone and the file picker.
- **Taking over an existing type behind a flag.** Keep the flag-off branch in
  `load` download-only. If the type used to route to another block, branch in
  `fileTypeToBlockName` and `verifyBlockName` in `allBlocks.ts` as `write`
  does.
- **Search.** Add the type to `is_searchable_file_type` in
  `crates/models_search/src/unified.rs`, a parser in
  `services/search_processing_service/src/parsers/<type>.rs` (registered in
  `parsers/mod.rs`), and the dispatch in
  `services/search_processing_service/src/process/document/raw_document.rs`.
- **AI tools.** To let agents read or edit the file, add a domain module and
  toolset under `crates/documents` (`domain/photoshop.rs`,
  `inbound/toolset/photoshop.rs`), route it in
  `inbound/toolset/read_content.rs`, and give attachments context in
  `inbound/attachment/service.rs`. Follow the
  [create-ai-tool skill](../../.agents/skills/create-ai-tool/SKILL.md) for
  wiring, `bun run gen-tools`, the tool-call UI
  (`apps/web/src/lib/core/component/AI/component/tool/handler.tsx`,
  `apps/web/src/features/block-agent/component/parts/MacroToolCall.tsx`,
  `apps/web/src/features/block-agent/state/tool-approval-wording.ts`), and the
  MCP docs pages under `apps/docs/AI/mcp/tools/`.
- **Saving.** Save through document storage from `queries/` (service clients
  outside `queries/` fail the `ts-no-service-client-outside-queries` rule).
  Await the final save before the engine closes, or edits are lost when the
  user navigates away. A save of a file at the upload size limit must still fit
  under the endpoint's body limit (`simple_save::MAX_BODY_BYTES` in
  `services/document_storage_service/src/api/documents.rs` allows for the
  multipart framing; it once didn't).

## 5. Entity type (entity-backed blocks)

The backend entity comes first: `EntityType` in `crates/model-entity/src/lib.rs`,
`crates/graphql_common/src/entity_type.rs`, access checks in
`crates/entity_access`, and a domain crate. Use the
[database-core](../../.agents/skills/database-core/SKILL.md) and
[collab-surface-core](../../.agents/skills/collab-surface-core/SKILL.md) skills
when they apply. Then, on the web:

- `apps/web/src/lib/service-clients/service-storage/itemType.ts`: `ItemType`,
  `stringToItemType`, and `blockNameToItemType`. Never cast a string to
  `ItemType` (FE-31).
- `apps/web/src/features/entity/types/entity.ts`: an `<Name>Entity` type in
  `EntityData` and `ENTITY_TYPE_VALUES`.
- `apps/web/src/lib/core/component/EntityIcon.tsx`: an arm in
  `getEntityIconType`.
- `apps/web/src/lib/core/component/BlockContainer.tsx` (`resolveEntityType`)
  and `apps/web/src/lib/core/internal/trackBlockOpened.ts` (`isSoupEntityTag`).
- Previews: a fetcher in `apps/web/src/lib/queries/preview/fetchers.ts`, so
  cards and mentions show a name, `no_access`, or `does_not_exist`.
- Quick Access (`apps/web/src/lib/core/context/quickAccess/types.ts`), sharing
  (`apps/web/src/features/sharing/global-share-modal/shareable-entity.ts`),
  Drive's data sources and filters (`apps/web/src/features/drive-view/`), and
  the Soup row actions in `apps/web/src/features/next-soup/actions/`. An entity
  outside Soup is invisible in Drive, search, and Cmd+K until each is wired;
  databases shipped missing from Drive and needed a follow-up for all of them.
- Agent mentions: add the `blockName` to `crates/prompt/src/mentions.rs`, or
  agents link the entity as a plain URL.

## 6. Wasm engine (blocks with a Rust engine)

Engines are Rust crates in this repo, compiled to wasm for the browser and used
natively by search and AI tools. The DOCX editor launched on an npm runtime and
was moved onto `crates/docx_engine` the next day; start with a crate.

- **Crate.** `crates/<x>_engine`, a workspace member in the root `Cargo.toml`,
  and a `[profile.<x>-engine-wasm]` (`inherits = "release"`, `lto = "fat"`,
  `codegen-units = 1`). Add it to the wasm-safe exclusion list in
  `.config/hakari.toml`, then run `just hakari` and commit
  `crates/workspace-hack` and `.github/workspace-dep-closures.json`.
- **Build recipes** in `apps/web/justfile`: `build-<x>-engine-wasm` (wasm-pack
  into `src/lib/core/<x>-engine/wasm`) and `ensure-<x>-engine-wasm` (rebuild only
  when the crate, or a crate it depends on such as `fig_engine`, is newer than
  the output). Add the build recipe to `build-wasm`, which CI's web build and
  the release builds run, and the ensure recipe to `dev:prepare` in
  `apps/web/package.json` and to `apps/web/tests/native/build.sh`.
  `build-tauri-dev`, which builds iOS PR previews, lists its wasm recipes
  separately and builds no engines today; add yours there if the block must
  work in those previews.
- **Output stays out of git.** Put a `.gitignore` containing `wasm/` in
  `src/lib/core/<x>-engine/`. If the crate has a Rust module named `build`,
  un-ignore it in the root `.gitignore`; `**/build` silently drops its files.
- **Assets the engine embeds.** Files read with `include_bytes!` must match
  `assetFilter` in `nix/cloud-storage.nix` for any service that links the
  engine; `.ttf` and `.xml` were missing and broke the deploy.
- **Client** in `apps/web/src/lib/core/<x>-engine/`: `client.ts` (typed
  requests), `<x>.worker.ts`, `protocol.ts`, `types.ts`, `wasm-module.ts`.
  - Construct the `Worker` on first use, never at module load: an eager module
    worker deadlocks WKWebView on iOS ([web agent guide](../../apps/web/AGENTS.md)).
  - Write `new Worker(new URL('./<x>.worker.ts', import.meta.url), { type: 'module' })`
    inline. Vite only bundles the worker in that exact shape; hoisting the URL
    shipped raw TypeScript to production.
  - Load the binary with a static
    `new URL('./wasm/<x>_engine_bg.wasm', import.meta.url)` passed to the
    generated init. The generated JS's own relative URL 404s in production
    builds.
  - Keep the engine out of the entry chunk: `definition.ts` and shared helpers
    import only types from it, and nothing touches it at module load.
  - Open the block in the native iOS app once. Relative wasm URLs there were
    routed to native HTTP until `apps/web/src/index.tsx` resolved them first.
- **Untrusted input.** Parsers get fixed budgets for decompression, pixel
  counts, and allocation that never trust sizes declared in the file.
- CI's vitest job builds no engine wasm. Unit tests must not load it; mock
  the engine client or test pure `core/` functions.

## 7. Create flows

- `queries/create-<name>.ts` (`block-psd/queries/create-psd.ts`): create the
  document (`storageServiceClient.createDocument`, then `uploadToPresignedUrl`)
  or the entity through its API, then `postNewHistoryItem`, `setPreviewOnCreate`,
  `refetchSoupEntity`, and `analytics.track('create_entity', ...)`.
- `apps/web/src/features/command/Launcher.tsx`:
  - a case in `runCreateAction`, behind the flag;
  - an entry in `CREATABLE_BLOCKS` with an unused one-letter `hotkey`;
  - the flag subscribed in `useCreateMenuBlocks`, or a flag that resolves after
    mount leaves the menu stale until reload.

  `CREATABLE_BLOCKS` also feeds the sidebar, Drive, and mobile create menus.
- `apps/web/src/features/command/core/create-menu-details.ts`: a `DETAILS`
  entry (group, tagline, details, examples) and a `SHORT_TAGLINES` entry, both
  keyed by the launcher **label**. A label with no entry silently lands in
  "Other".
- `apps/web/src/lib/core/hotkey/tokens.ts`: `TOKENS.create.<name>` and
  `<name>NewSplit`.
- `apps/web/src/features/block-project/component/ProjectCreateMenu.tsx`: a
  spec, plus the flag check in both filters.
- `apps/web/src/features/command/Launcher.test.ts` and `Launcher.test.tsx`: mock
  your create module and flag. The test fails on duplicate hotkeys.

## 8. Tests

- Colocated vitest for `core/`, `primitives/` (with fake sources), and
  `queries/` (with fake clients), per [frontend feature
  architecture](../architecture/frontend-features.md#testing-the-boundaries).
- **Test the real load path.** The DOCX load failure in section 1 shipped
  because the editor's standalone harness skips the block loader. Add a
  `definition.test.ts` that drives `load` the way the app does
  (`block-write/definition.test.ts`).
- Engine editors get a browser fixture in `block-<name>/browser-test/`
  (`vite.config.ts`, `playwright.config.ts`, `README.md`; see
  `block-psd/browser-test/README.md`). These don't run in CI; run them before
  you push.
- Backend: tests beside each new parser, toolset, and domain module.

## 9. Agent guide

The block adds a route and a create flow, so add a section to
[`docs/agent-guide/documents.md`](../agent-guide/documents.md) (or its own
page, as [`forms.md`](../agent-guide/forms.md) is) and update the table in
[`docs/agent-guide/README.md`](../agent-guide/README.md) in the same change.
Cover how to create one, what the editor's controls are, and how to verify a
save.

## Verify locally

```sh
cd apps/web
just ensure-<x>-engine-wasm                     # engine blocks
bun run type-check
bun run test -- src/features/block-<name> src/lib/core/constant src/features/command
bunx playwright test --config src/features/block-<name>/browser-test/playwright.config.ts
PORT=3003 bun run dev                           # any free port in 3000-3009
```

```sh
cargo test -p <x>_engine -p documents -p search_processing_service -p model_file_type
just check
```

In the browser, with the flag on and then off:

- create one from Cmd+K, the sidebar, and a project, and from the hotkey;
- upload a real file (file-backed), including an uppercase extension;
- open it from Home, Drive, search, a mention, and a pasted `/app/<name>/<id>`
  link, in a new split, and on a phone-width window;
- share it as view and edit with a second account and edit together;
- reload and confirm the last edit was saved.

Then check the startup bundle didn't grow: run `bun run build` here and on
`main`, and compare the scripts `dist/index.html` loads directly.
