# Shared database editor

`DatabaseProvider` owns one editor controller. A host supplies `DatabaseApi` with a
stable cache key, schema reads, paginated row reads, and atomic operation batches.
`DatabaseRecords` supplies the standard column controls, grid, board and record
panel. The host supplies presentation slots and navigation when needed.

```tsx
const [view, setView] = createSignal<DatabaseViewState>({
  query: { filter: null },
  layout: { kind: 'table', columns: [] },
});

<DatabaseProvider
  api={api}
  tableId={tableId}
  view={view()}
  capabilities={{ editRows: canEdit, editColumns: canEditSchema }}
>
  <DatabaseRecords
    view={view()}
    stored={false}
    onViewChange={(change) => setView((view) => ({ ...view, ...change }))}
    renderMentionPicker={HostMentionPicker}
  />
</DatabaseProvider>
```

Mount under the application's `QueryClientProvider`, or supply one for a standalone
surface. Remount the database provider when its API identity or table changes;
views and permission changes are reactive within that lifetime. `useDatabase()`
exposes the controller to other controls inside this editor. Small presentation
components remain usable with props and without this context.

## API semantics

- `readTable` returns normalized editor columns, with names, types, options and
  protections. Hosts convert their transport DTOs at the adapter boundary.
- `readRows` applies the requested filter and sort before pagination. Every page
  carries its table version. The shared source restarts inconsistent reads rather
  than combining pages from different versions. `rowIds` reads retained records
  outside the active filter, so an open record remains available.
- `applyOps` uses the existing `DatabaseOp` protocol and optional `baseVersions`.
  It must commit the batch atomically. The shared row writer adds missing options
  in the same batch and distinguishes a refused insert from an unknown outcome.
- A successful commit remains successful if a subsequent refresh fails. The
  queries own refresh errors; retrying the mutation could duplicate an insert.

The API does not require SQL reads, a Macro database entity, Soup, app block
context, or a particular URL layout. `DatabaseApi.key` must identify the host and
resource within the query cache. Authentication and resource authorization belong
to the host's API/service; UI capabilities only determine which controls appear.

## Host capabilities

`editRows` and `editColumns` enable their respective controls. Optional record-view
props supply persisted board positions, conversion previews, relationships,
presence, and stored-view changes. Omit an unsupported action. A board can render
without a position writer; it cannot offer card moves that pretend to persist.
View preferences in the example are local; hosts that save views pass their own
view state and authorized persistence callback. Shared filter, sort, toolbar and
view components are in `components/`.

The Macro app's `DatabaseGrid` supplies an optimized `DatabaseDataSource` to the
same provider, preserving SQL caching, incremental updates and first-value type
inference. Normal API hosts use the provider's built-in paginated source. Both
paths share row-op construction and the schema controller. The app keeps its
sharing, navigation, Forms integration and concrete network clients in
`features/block-database/`.

The API-only browser fixture is in
`../block-database/browser-test/api.tsx`. It exercises pagination, row edits,
column creation, permission changes and board rendering without app providers
beyond the query client. The CRM feature uses `createPipelineApi` and the same provider/controller; its
browser fixture is `../crm/browser-test/editor.tsx`.
