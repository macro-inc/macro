import '@app/index.css';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { encodeCellMention } from '@macro-inc/spreadsheet/cell-mentions';
import { okAsync, ResultAsync } from 'neverthrow';
import { createSignal, onMount, Show } from 'solid-js';
import { Portal, render } from 'solid-js/web';
import { CellMentionEditor } from '../../../components/cell-text-editor/CellMentionEditor';
import type {
  DatabaseRowsSnapshot,
  DatabaseRowsSource,
} from '../../database/context/table-source';
import type { DatabaseViewColumn } from '../../database/core/database-view';
import { optimisticRows } from '../../database/core/table';
import { DatabaseRecordsView } from '../../database/views/database-records-view';
import {
  DatabaseLinkValue,
  DatabaseTextEditor,
  DatabaseTextValue,
} from '../database-mentions';

const MULTILINE_ROWS = [
  {
    rowId: 'wrapped',
    cells: {
      name: 'Wrapped',
      notes:
        'Long note: ' +
        'they asked about pricing tiers, onboarding timelines and security reviews before renewal. '.repeat(
          3
        ),
    },
  },
  {
    rowId: 'lines',
    cells: { name: 'Lines', notes: 'Line one\nLine two\nLine three' },
  },
  { rowId: 'last', cells: { name: 'Last', notes: 'Last note' } },
  {
    rowId: 'mention',
    cells: {
      name: 'Mention',
      notes:
        'Renewal call: ' +
        'they want the security review and the onboarding plan before the call. '.repeat(
          2
        ) +
        encodeCellMention({
          type: 'date',
          date: '2026-11-20T00:00:00.000Z',
          displayFormat: 'Nov 20, 2026',
        }),
    },
  },
];

// Synthetic contacts: some names are email addresses (links), some plain names.
const CONTACT_ROWS = Array.from({ length: 180 }, (_, index) => {
  const plain = index % 3 === 1;
  const email = `person.${index}.with.a.long.address@example.com`;
  return {
    rowId: `contact-${index}`,
    cells: {
      name: plain ? `Person ${index}` : email,
      count: index,
      email: index % 4 === 0 ? `Person ${index}` : email,
      company: index % 5 === 0 ? null : `Example ${index} Ltd`,
    },
  };
});

type FixtureModes = {
  references: boolean;
  links: boolean;
  multiline: boolean;
  contacts: boolean;
};

function initialColumns(modes: FixtureModes & { rapid: boolean }) {
  const { references, links, multiline, contacts, rapid } = modes;
  const columns: DatabaseViewColumn[] = [
    {
      id: 'name',
      name: 'Name',
      dataType: 'STRING',
      writable: true,
      isMultiSelect: false,
      options: [],
    },
  ];
  if (references)
    columns.push({
      ...columns[0],
      id: 'file',
      name: 'File',
      dataType: 'ENTITY',
      specificEntityType: 'DOCUMENT',
    });
  if (links)
    columns.push(
      { ...columns[0], id: 'notes', name: 'Notes' },
      { ...columns[0], id: 'website', name: 'Website', dataType: 'LINK' }
    );
  if (multiline) columns.push({ ...columns[0], id: 'notes', name: 'Notes' });
  if (contacts)
    columns.push(
      { ...columns[0], id: 'count', name: 'Count', dataType: 'NUMBER' },
      { ...columns[0], id: 'email', name: 'Email' },
      { ...columns[0], id: 'company', name: 'Company' }
    );
  if (rapid)
    columns.push(
      ...['notes', 'detail'].map((id) => ({
        ...columns[0],
        id,
        name: id,
      }))
    );
  return columns;
}

function initialRows(modes: FixtureModes) {
  const { references, links, multiline, contacts } = modes;
  return contacts
    ? CONTACT_ROWS
    : [
        {
          rowId: 'one',
          cells: {
            name: 'First record',
            ...(references ? { file: 'project-plan' } : {}),
            ...(links
              ? {
                  notes: 'Spec at https://example.com/spec',
                  website: 'example.com',
                }
              : {}),
            ...(multiline ? { notes: 'Follow up' } : {}),
          },
        },
        ...(multiline ? MULTILINE_ROWS : []),
      ];
}

// A host owns the records and writes. No database entity, saved view, or app provider.
function RecordsFixture() {
  const references = new URLSearchParams(location.search).has('references');
  const [opened, setOpened] = createSignal('');
  const rapid = new URLSearchParams(location.search).has('rapid');
  const links = new URLSearchParams(location.search).has('links');
  const holdWrites = new URLSearchParams(location.search).has('holdWrites');
  // The app's text editor and value renderers over wrapped and multi-line notes.
  const multiline = new URLSearchParams(location.search).has('multiline');
  const contacts = new URLSearchParams(location.search).has('contacts');
  const multilineEditor = multiline ? DatabaseTextEditor : undefined;
  let releaseWrites!: () => void;
  const writeGate = holdWrites
    ? new Promise<void>((resolve) => {
        releaseWrites = resolve;
      })
    : Promise.resolve();
  const [columns, setColumns] = createSignal(
    initialColumns({ references, links, multiline, contacts, rapid })
  );
  const [snapshot, setSnapshot] = createSignal<DatabaseRowsSnapshot>({
    rows: initialRows({ references, links, multiline, contacts }),
    retained: [],
    version: 1,
  });
  const [canEdit, setCanEdit] = createSignal(true);
  let nextRow = 0;
  const source: DatabaseRowsSource = {
    columns,
    snapshot,
    read: () => undefined,
    loading: () => false,
    refreshing: () => false,
    error: () => undefined,
    refresh: () => okAsync(undefined),
    addOption: () => okAsync(undefined),
    retain: () => {},
    write: (mutation) =>
      ResultAsync.fromSafePromise(
        holdWrites
          ? writeGate
          : rapid
            ? new Promise<void>((resolve) => setTimeout(resolve, 80))
            : Promise.resolve()
      ).andThen(() => {
        const current = snapshot();
        const version = (current.version ?? 0) + 1;
        const insertedRowIds =
          mutation.kind === 'create' ? [`created-${++nextRow}`] : [];
        const rows =
          mutation.kind === 'create'
            ? [
                ...current.rows,
                { rowId: insertedRowIds[0], cells: mutation.values },
              ]
            : optimisticRows(current.rows, [mutation]);
        setSnapshot({ rows, retained: [], version });
        return okAsync({ version, insertedRowIds });
      }),
  };
  return (
    <main class="flex h-screen flex-col bg-panel text-ink">
      <div class="flex gap-4 p-4">
        <button onClick={() => setCanEdit(false)}>Read only</button>
        {holdWrites && (
          <button
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => releaseWrites()}
          >
            Release saves
          </button>
        )}
        {rapid && (
          <button
            onMouseDown={(event) => event.preventDefault()}
            onClick={() =>
              setColumns((columns) =>
                columns.map((column) =>
                  column.id === 'notes'
                    ? { ...column, dataType: 'NUMBER' }
                    : column
                )
              )
            }
          >
            Infer numbers
          </button>
        )}
        <output aria-label="Stored name">
          {snapshot().rows[0]?.cells.name}
        </output>
        <output aria-label="Stored records" class="sr-only">
          {JSON.stringify(snapshot().rows)}
        </output>
      </div>
      <div class="flex min-h-0 flex-1">
        <section class="flex min-w-0 flex-1 flex-col">
          <DatabaseRecordsView
            name="Embedded records"
            contentClass={
              multiline
                ? 'mx-4 mb-4 mt-1 rounded-xl border border-edge-muted'
                : undefined
            }
            source={source}
            canEdit={canEdit()}
            onOpenDocumentMention={setOpened}
            renderMentionValue={(id) => (
              <span>
                {id === 'project-plan' ? 'Project plan' : 'Design notes'}
              </span>
            )}
            renderMentionPicker={(picker) => <ReferencePicker {...picker} />}
            renderTextValue={
              links || multiline || contacts
                ? (value) => <DatabaseTextValue value={value} />
                : undefined
            }
            renderLinkValue={
              links ? (url) => <DatabaseLinkValue url={url} /> : undefined
            }
            renderTextEditor={
              rapid
                ? (props) => (
                    <CellMentionEditor
                      {...props}
                      convertPaste={(text) => text}
                      renderMenu={() => null}
                    />
                  )
                : multilineEditor
            }
            view={{
              query: { filter: null },
              layout: { kind: 'table', columns: [] },
            }}
            stored={false}
            boardPositions={{
              state: () => ({ kind: 'ready', positions: [] }),
              setPositions: () => {},
              move: () => okAsync({ positions: [], tableVersion: 1 }),
            }}
          />
        </section>
        <Show when={opened()}>
          <aside
            aria-label="Opened file"
            class="w-80 border-l border-edge-muted p-4"
          >
            <h1>
              {opened() === 'project-plan' ? 'Project plan' : 'Design notes'}
            </h1>
            <p>Referenced file opened beside the database.</p>
          </aside>
        </Show>
      </div>
    </main>
  );
}

function ReferencePicker(
  props: import('../../database/components/grid-cell').DatabaseMentionPickerProps
) {
  let input!: HTMLInputElement;
  onMount(() => input.focus());
  return (
    <Portal mount={props.mount}>
      <div
        role="dialog"
        aria-label="Choose file"
        class="menu-surface fixed z-50 flex flex-col gap-2 p-3"
        style={{
          top: `${props.anchor?.getBoundingClientRect().bottom ?? 0}px`,
          left: `${props.anchor?.getBoundingClientRect().left ?? 0}px`,
        }}
      >
        <input
          ref={input}
          aria-label="Find a file"
          value={props.search}
          onInput={(event) => props.onSearchChange?.(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              props.onClose();
            }
          }}
        />
        <button
          onClick={() =>
            props.onSelect({
              id: 'design-notes',
              entityType: 'DOCUMENT',
              label: 'Design notes',
            })
          }
        >
          Design notes
        </button>
      </div>
    </Portal>
  );
}

render(
  () => (
    <StaticMarkdownContext>
      <RecordsFixture />
    </StaticMarkdownContext>
  ),
  document.getElementById('root')!
);
