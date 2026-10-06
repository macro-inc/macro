import type {
  Board,
  Catalog,
  Outcome,
} from '@core/database-sql/generated/types';
import type { DatabaseOpsError } from '@service-storage/databases';
import type { DatabaseView } from '@service-storage/generated/schemas/databaseView';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import {
  err,
  errAsync,
  ok,
  okAsync,
  type Result,
  ResultAsync,
} from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseWriteResult } from '../context/table-source';
import type { DatabaseViewColumn } from '../core/database-view';
import type { ViewChange } from '../core/view-state';
import { allRecordsView } from '../core/views';
import type { DatabaseWriteFailure } from '../core/write-failure';
import { createFakeRowsSource, titleContains } from '../tests/fake-rows-source';
import type { BoardPositions } from './database-board-view';
import {
  type DatabaseRecordsActions,
  DatabaseRecordsView,
} from './database-records-view';

// Date interactions are covered by the GridCell tests.
vi.mock('@property/editors/selectors/PropertyDateSelector', () => ({
  PropertyDateSelector: () => null,
}));
vi.mock('@core/database-sql/wasm-module', () => ({
  // Stands in for the engine's board: the layout's listed lanes, each holding
  // the answered rows whose group cell names its option.
  loadDatabaseSqlWasm: () =>
    Promise.resolve({
      board: (_catalog: Catalog, view: DatabaseView, outcome: Outcome) => {
        const layout = view.layout;
        if (layout.kind !== 'board') throw new Error('Not a board');
        const group = outcome.columns.findIndex(
          (column) => column.column === layout.groupBy
        );
        const board: Board = {
          lanes: layout.lanes.map((lane) => ({
            key: lane.key,
            hidden: !!lane.hidden,
            cards: outcome.rowIds.filter((_rowId, index) => {
              const cell = outcome.rows[index][group];
              const option =
                cell?.type === 'options' ? (cell.value[0] ?? null) : null;
              return lane.key.kind === 'option'
                ? option === lane.key.id
                : option === null;
            }),
          })),
        };
        return board;
      },
    }),
}));

const columns: DatabaseViewColumn[] = [
  {
    id: 'title',
    name: 'Name',
    dataType: 'STRING',
    isMultiSelect: false,
    options: [],
    writable: true,
  },
  {
    id: 'status',
    name: 'Status',
    dataType: 'SELECT_STRING',
    isMultiSelect: false,
    options: [
      { id: 'todo', label: 'To do', color: null },
      { id: 'done', label: 'Done', color: null },
    ],
    writable: true,
  },
];

const allRecords = allRecordsView({ id: 'projects', database_id: 'work' });

const statusBoard: DatabaseView = {
  ...allRecords,
  layout: {
    kind: 'board',
    title: 'title',
    groupBy: 'status',
    lanes: [
      { key: { kind: 'option', id: 'done' }, hidden: false },
      { key: { kind: 'option', id: 'todo' }, hidden: false },
    ],
    cardFields: [],
    hideEmptyLanes: false,
  },
};

/** Cards with no stored places: each lane keeps the rows' order. */
const unplacedCards: BoardPositions = {
  state: () => ({ kind: 'ready', positions: [] }),
  setPositions: () => {},
  move: () => okAsync({ positions: [], tableVersion: 1 }),
};

const lostConnection: DatabaseWriteFailure = {
  kind: 'ops',
  error: { code: 'NETWORK_ERROR', message: 'Connection lost', refusal: null },
};

function columnOrderFixture() {
  const { source, setColumns } = createFakeRowsSource({
    columns,
    table: {
      version: 1,
      rows: [
        { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
      ],
    },
    view: allRecords,
  });
  setColumns([
    columns[0],
    { ...columns[0], id: 'notes', name: 'Notes' },
    { ...columns[0], id: 'owner', name: 'Owner' },
  ]);
  const [view, setView] = createSignal<DatabaseView>({
    ...allRecords,
    layout: {
      kind: 'table',
      columns: [
        { column: 'title', width: null },
        { column: 'notes', width: null },
        { column: 'owner', width: null },
      ],
    },
  });
  const changeView = vi.fn((change: ViewChange) =>
    setView((current) => ({ ...current, ...change }))
  );
  const requests: {
    resolve: () => void;
    reject: (error: DatabaseOpsError) => void;
  }[] = [];
  const reorder = vi.fn(
    (_order: string[]) =>
      new ResultAsync(
        new Promise<Result<void, DatabaseOpsError>>((resolve) =>
          requests.push({
            resolve: () => resolve(ok(undefined)),
            reject: (error) => resolve(err(error)),
          })
        )
      )
  );
  const mounted = render(() => (
    <DatabaseRecordsView
      name="Projects"
      source={source}
      canEdit
      view={view()}
      stored={false}
      onViewChange={changeView}
      onReorderColumns={reorder}
      addColumn={() => null}
      boardPositions={unplacedCards}
    />
  ));
  const moveName = async (direction: 'left' | 'right') => {
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Name column menu' }),
      {
        key: 'Enter',
      }
    );
    fireEvent.keyDown(
      await screen.findByRole('menuitem', { name: `Move ${direction}` }),
      {
        key: 'Enter',
      }
    );
  };
  const headers = () =>
    screen
      .getAllByRole('button', { name: / column menu$/ })
      .map((button) => button.getAttribute('aria-label'));
  return {
    ...mounted,
    view,
    setView,
    changeView,
    reorder,
    requests,
    moveName,
    headers,
  };
}

beforeEach(() => {
  const style = document.createElement('style');
  style.textContent =
    '[role="menu"], [role="dialog"] { animation-name: none; }';
  document.head.append(style);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  // JSDOM has no layout, so a highlighted row cannot scroll itself into view.
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  document.head.querySelectorAll('style').forEach((style) => style.remove());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('database table view', () => {
  it('edits host-owned records with only layout state and no schema actions', async () => {
    const fixture = createFakeRowsSource({
      columns: [columns[0]],
      table: {
        version: 1,
        rows: [{ rowId: 'row', cells: { title: 'Plan launch' } }],
      },
      view: allRecords,
    });
    fixture.persistWrites();
    render(() => (
      <DatabaseRecordsView
        name="Embedded records"
        source={fixture.source}
        canEdit
        view={{
          query: { filter: null },
          layout: { kind: 'table', columns: [] },
        }}
        stored={false}
        boardPositions={unplacedCards}
      />
    ));
    expect(screen.getAllByRole('columnheader')).toHaveLength(2);
    expect(screen.getByRole('grid').getAttribute('aria-colcount')).toBe('2');
    const user = userEvent.setup();
    await user.dblClick(
      screen.getByRole('button', { name: /^Name: Plan launch\./ })
    );
    const input = screen.getByRole('textbox', { name: 'Edit Name' });
    await user.clear(input);
    await user.type(input, 'Launch ready');
    await user.keyboard('{Tab}');
    await waitFor(() =>
      expect(fixture.source.snapshot()?.rows[0].cells.title).toBe(
        'Launch ready'
      )
    );
    expect(screen.queryByRole('button', { name: 'Add column' })).toBeNull();
  });

  it('offers refresh and draft recovery after a lost create response without a duplicate Retry', async () => {
    const fixture = createFakeRowsSource({
      columns,
      table: {
        version: 1,
        rows: [
          { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
        ],
      },
      view: allRecords,
    });
    fixture.setColumns([columns[0]]);
    fixture.setTable({ version: 1, rows: [] });
    fixture.persistWrites();
    const commit = vi.mocked(fixture.source.write).getMockImplementation()!;
    vi.mocked(fixture.source.write).mockImplementationOnce(
      (mutation, version, createOptions) =>
        commit(mutation, version, createOptions).andThen(() =>
          errAsync<DatabaseWriteResult, DatabaseWriteFailure>({
            kind: 'outcome-unknown',
          })
        )
    );
    render(() => (
      <DatabaseRecordsView
        name="Projects"
        source={fixture.source}
        canEdit
        view={allRecords}
        stored={false}
        addColumn={() => null}
        boardPositions={unplacedCards}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: /Name: Unnamed/ }));
    const input = screen.getByRole('textbox', { name: 'Edit Name' });
    fireEvent.input(input, { target: { value: 'Saved once' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText('This row may already be saved.');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    await waitFor(() =>
      expect(
        (
          screen.getByRole('button', {
            name: /^Refresh$/,
          }) as HTMLButtonElement
        ).disabled
      ).toBe(false)
    );
    fireEvent.click(screen.getByRole('button', { name: /^Refresh$/ }));
    await waitFor(() =>
      expect(fixture.source.refresh).toHaveBeenCalledTimes(2)
    );
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(fixture.source.write).toHaveBeenCalledOnce();
    expect(fixture.source.snapshot()?.rows).toEqual([
      { rowId: 'created', cells: { title: 'Saved once' } },
    ]);
    expect(
      screen.getAllByRole('button', { name: /Name: Saved once/ })
    ).toHaveLength(1);
  });

  it('opens a compact record editor with its title only once and tabs into the next field', async () => {
    const fixture = createFakeRowsSource({
      columns,
      table: {
        version: 1,
        rows: [
          { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
        ],
      },
      view: allRecords,
    });
    fixture.persistWrites();
    render(() => (
      <DatabaseRecordsView
        name="Projects"
        source={fixture.source}
        canEdit
        view={allRecords}
        stored={false}
        addColumn={() => null}
        boardPositions={unplacedCards}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Open Plan launch' }));
    const dialog = await screen.findByRole('dialog', { name: 'Plan launch' });
    const input = within(dialog).getByRole('textbox', {
      name: 'Edit Name',
    }) as HTMLInputElement;
    expect(
      within(dialog).queryByRole('button', { name: /Name: Plan launch/ })
    ).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    fireEvent.input(input, { target: { value: 'Launch plan' } });
    fireEvent.keyDown(input, { key: 'Tab' });
    await screen.findByRole('option', { name: 'Done' });
    await waitFor(() =>
      expect(fixture.source.write).toHaveBeenCalledWith(
        { kind: 'cell', rowId: 'row', columnId: 'title', value: 'Launch plan' },
        1,
        false
      )
    );
    expect(
      within(dialog)
        .getByRole('button', { name: 'Status: To do', hidden: true })
        .getAttribute('aria-expanded')
    ).toBe('true');
  });

  it('cancels the title draft with Escape before closing the record on a second Escape', async () => {
    const { source } = createFakeRowsSource({
      columns,
      table: {
        version: 1,
        rows: [
          { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
        ],
      },
      view: allRecords,
    });
    render(() => (
      <DatabaseRecordsView
        name="Projects"
        source={source}
        canEdit
        view={allRecords}
        stored={false}
        addColumn={() => null}
        boardPositions={unplacedCards}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Open Plan launch' }));
    const input = await screen.findByRole('textbox', { name: 'Edit Name' });
    fireEvent.input(input, { target: { value: 'Discard this title' } });
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Edit Name' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Plan launch' })).toBeTruthy();
    expect(source.write).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('focuses the title when a read-only record opens', async () => {
    const { source } = createFakeRowsSource({
      columns,
      table: {
        version: 1,
        rows: [
          { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
        ],
      },
      view: allRecords,
    });
    render(() => (
      <DatabaseRecordsView
        name="Projects"
        source={source}
        canEdit={false}
        view={allRecords}
        stored={false}
        addColumn={() => null}
        boardPositions={unplacedCards}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Open Plan launch' }));
    const dialog = await screen.findByRole('dialog', { name: 'Plan launch' });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(dialog).getByRole('button', { name: 'Name: Plan launch' })
      )
    );
    expect(source.write).not.toHaveBeenCalled();
  });

  it.each(['option', 'number'])(
    'discards an unsaved %s draft when navigating to another record',
    async (kind) => {
      const fixture = createFakeRowsSource({
        columns,
        table: {
          version: 1,
          rows: [
            { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
          ],
        },
        view: allRecords,
      });
      fixture.setColumns([
        ...columns,
        { ...columns[0], id: 'amount', name: 'Amount', dataType: 'NUMBER' },
      ]);
      fixture.setTable({
        version: 1,
        rows: [
          {
            rowId: 'row',
            cells: { title: 'Plan launch', status: 'To do', amount: 12 },
          },
          {
            rowId: 'next',
            cells: { title: 'Next project', status: 'Done', amount: 24 },
          },
        ],
      });
      render(() => (
        <DatabaseRecordsView
          name="Projects"
          source={fixture.source}
          canEdit
          view={allRecords}
          stored={false}
          addColumn={() => null}
          boardPositions={unplacedCards}
        />
      ));
      fireEvent.click(screen.getByRole('button', { name: 'Open Plan launch' }));
      const dialog = await screen.findByRole('dialog', { name: 'Plan launch' });
      if (kind === 'option') {
        fireEvent.click(
          within(dialog).getByRole('button', { name: 'Status: To do' })
        );
        const input = await screen.findByRole('combobox', {
          name: 'Search Status options',
        });
        fireEvent.input(input, { target: { value: 'Unsubmitted option' } });
      } else {
        await userEvent.click(
          within(dialog).getByRole('button', { name: /Amount: 12/ })
        );
        const input = within(dialog).getByRole('textbox', {
          name: 'Edit Amount',
        });
        fireEvent.input(input, { target: { value: 'Invalid number' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(within(dialog).getByRole('alert').textContent).toBe(
          'Enter a valid number'
        );
      }
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Next record' })
      );
      await screen.findByRole('dialog', { name: 'Next project' });
      expect(
        screen.queryByRole('combobox', { name: 'Search Status options' })
      ).toBeNull();
      expect(
        within(dialog).queryByRole('textbox', { name: 'Edit Amount' })
      ).toBeNull();
      expect(within(dialog).queryByRole('alert')).toBeNull();
      const title = within(dialog).getByRole('textbox', {
        name: 'Edit Name',
      }) as HTMLInputElement;
      expect(title.value).toBe('Next project');
      await waitFor(() => expect(document.activeElement).toBe(title));
      expect(fixture.source.write).not.toHaveBeenCalled();
      expect(fixture.source.addOption).not.toHaveBeenCalled();
    }
  );

  it('tabs into the blank row while the previous edit saves without creating an empty record', async () => {
    const fixture = createFakeRowsSource({
      columns,
      table: {
        version: 1,
        rows: [
          { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
        ],
      },
      view: allRecords,
    });
    fixture.setColumns([columns[0]]);
    let complete!: () => void;
    vi.mocked(fixture.source.write).mockImplementationOnce(() =>
      ResultAsync.fromSafePromise(
        new Promise<void>((resolve) => {
          complete = resolve;
        })
      ).map(() => ({ version: 2, insertedRowIds: [] }))
    );
    render(() => (
      <DatabaseRecordsView
        name="Projects"
        source={fixture.source}
        canEdit
        view={allRecords}
        stored={false}
        addColumn={() => null}
        boardPositions={unplacedCards}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: /Name: Plan launch/ }));
    fireEvent.input(screen.getByRole('textbox', { name: 'Edit Name' }), {
      target: { value: 'Updated launch' },
    });
    await userEvent.tab();
    const next = await screen.findByRole('textbox', { name: 'Edit Name' });
    await waitFor(() => expect(document.activeElement).toBe(next));
    expect((next as HTMLInputElement).value).toBe('');
    expect(fixture.source.write).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Enter}');
    expect(fixture.source.write).toHaveBeenCalledTimes(1);
    complete();
    await waitFor(() => expect(fixture.source.refresh).toHaveBeenCalled());
    expect(fixture.source.write).toHaveBeenCalledExactlyOnceWith(
      {
        kind: 'cell',
        rowId: 'row',
        columnId: 'title',
        value: 'Updated launch',
      },
      1,
      false
    );
  });

  it.each([true, false])(
    'focuses the first cell after initial loading; empty table=%s',
    async (empty) => {
      const fixture = createFakeRowsSource({
        columns,
        table: {
          version: 1,
          rows: [
            { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
          ],
        },
        view: allRecords,
      });
      fixture.persistWrites();
      const [loading, setLoading] = createSignal(true);
      fixture.source.loading = loading;
      if (empty) fixture.setTable({ version: 1, rows: [] });
      let actions!: DatabaseRecordsActions;
      render(() => (
        <DatabaseRecordsView
          name="Projects"
          source={fixture.source}
          canEdit
          view={allRecords}
          stored={false}
          addColumn={() => null}
          actionsRef={(ready) => {
            actions = ready;
          }}
          boardPositions={unplacedCards}
        />
      ));
      const first = actions.focusFirstCell();
      const again = actions.focusFirstCell();
      expect(first).toBe(again);
      expect(fixture.source.write).not.toHaveBeenCalled();
      setLoading(false);
      await first;
      const name = await screen.findByRole('textbox', { name: 'Edit Name' });
      await waitFor(() => expect(document.activeElement).toBe(name));
      expect((name as HTMLInputElement).value).toBe(empty ? '' : 'Plan launch');
      expect(fixture.source.write).not.toHaveBeenCalled();
    }
  );

  it('inserts a new column beside the one whose menu asked, then opens its name for editing', async () => {
    const fixture = createFakeRowsSource({
      columns,
      table: {
        version: 1,
        rows: [
          { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
        ],
      },
      view: allRecords,
    });
    fixture.setColumns([
      columns[0],
      { ...columns[0], id: 'notes', name: 'Notes' },
    ]);
    const [view, setView] = createSignal(allRecords);
    const reorder = vi.fn((_order: string[]) => okAsync(undefined));
    const createColumn = vi.fn(() => {
      fixture.setColumns([
        columns[0],
        { ...columns[0], id: 'notes', name: 'Notes' },
        { ...columns[0], id: 'added', name: 'Column 3' },
      ]);
      return okAsync('added');
    });
    render(() => (
      <DatabaseRecordsView
        name="Projects"
        source={fixture.source}
        canEdit
        view={view()}
        stored={false}
        onViewChange={(change) =>
          setView((current) => ({ ...current, ...change }))
        }
        onReorderColumns={reorder}
        onRenameColumn={vi.fn(() => okAsync(undefined))}
        createColumn={createColumn}
        addColumn={() => null}
        boardPositions={unplacedCards}
      />
    ));
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Notes column menu' }),
      { key: 'Enter' }
    );
    fireEvent.keyDown(
      await screen.findByRole('menuitem', { name: 'Insert left' }),
      { key: 'Enter' }
    );
    await waitFor(() =>
      expect(reorder).toHaveBeenCalledWith(['title', 'added', 'notes'])
    );
    expect(createColumn).toHaveBeenCalledOnce();
    expect(view().layout).toEqual({
      kind: 'table',
      columns: [
        { column: 'title', width: null },
        { column: 'added', width: null },
        { column: 'notes', width: null },
      ],
    });
    const nameField = await screen.findByLabelText('Column name');
    expect((nameField as HTMLInputElement).value).toBe('Column 3');
  });

  it('holds a row in place while it is being typed in, even after it stops matching the view', async () => {
    const fixture = createFakeRowsSource({
      columns,
      table: {
        version: 1,
        rows: [
          { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
        ],
      },
      view: allRecords,
    });
    fixture.setTable({
      version: 1,
      rows: [
        { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
        { rowId: 'other', cells: { title: 'Book venue', status: 'To do' } },
      ],
    });
    render(() => (
      <DatabaseRecordsView
        name="Projects"
        source={fixture.source}
        canEdit
        view={allRecords}
        stored={false}
        addColumn={() => null}
        boardPositions={unplacedCards}
      />
    ));
    const cell = screen.getByRole('button', { name: /Name: Plan launch/ });
    fireEvent.click(cell);
    const input = (await screen.findByRole('textbox', {
      name: 'Edit Name',
    })) as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'Plan the launch party' } });
    // Someone else's edit makes this row stop matching the view's filters.
    fixture.setTable({
      version: 2,
      rows: [
        { rowId: 'other', cells: { title: 'Book venue', status: 'To do' } },
      ],
    });
    expect(screen.getByRole('textbox', { name: 'Edit Name' })).toBe(input);
    expect(input.value).toBe('Plan the launch party');
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /Name: Plan launch/ })
      ).toBeNull()
    );
  });

  it('takes a record visited from elsewhere to its highlighted row without opening it', async () => {
    const fixture = createFakeRowsSource({
      columns,
      table: {
        version: 1,
        rows: [
          { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
        ],
      },
      view: allRecords,
    });
    let actions!: DatabaseRecordsActions;
    render(() => (
      <DatabaseRecordsView
        name="Projects"
        source={fixture.source}
        canEdit
        view={allRecords}
        stored={false}
        addColumn={() => null}
        actionsRef={(ready) => {
          actions = ready;
        }}
        boardPositions={unplacedCards}
      />
    ));
    actions.openRecord('row');
    const cell = await screen.findByRole('button', {
      name: /Name: Plan launch/,
    });
    await waitFor(() => expect(document.activeElement).toBe(cell));
    expect(
      cell.closest('[data-grid-row-id="row"]')?.hasAttribute('data-highlighted')
    ).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens a record visited from elsewhere when the view has no row to show it in', async () => {
    const fixture = createFakeRowsSource({
      columns,
      table: {
        version: 1,
        rows: [
          { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
        ],
      },
      view: allRecords,
    });
    let actions!: DatabaseRecordsActions;
    render(() => (
      <DatabaseRecordsView
        name="Projects"
        source={fixture.source}
        canEdit
        view={statusBoard}
        stored
        addColumn={() => null}
        actionsRef={(ready) => {
          actions = ready;
        }}
        boardPositions={unplacedCards}
      />
    ));
    actions.openRecord('row');
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('cancels pending initial cell focus when the table is unmounted', async () => {
    const fixture = createFakeRowsSource({
      columns,
      table: {
        version: 1,
        rows: [
          { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
        ],
      },
      view: allRecords,
    });
    const [loading, setLoading] = createSignal(true);
    fixture.source.loading = loading;
    let actions!: DatabaseRecordsActions;
    const { unmount } = render(() => (
      <DatabaseRecordsView
        name="Projects"
        source={fixture.source}
        canEdit
        view={allRecords}
        stored={false}
        addColumn={() => null}
        actionsRef={(ready) => {
          actions = ready;
        }}
        boardPositions={unplacedCards}
      />
    ));
    const pending = actions.focusFirstCell();
    unmount();
    setLoading(false);
    await pending;
    expect(fixture.source.write).not.toHaveBeenCalled();
  });

  it.each(['clear', 'presence'] as const)(
    'uses saved row IDs for rectangle %s on a newly created draft',
    async (operation) => {
      const fixture = createFakeRowsSource({
        columns,
        table: {
          version: 1,
          rows: [{ rowId: 'row', cells: { title: 'Plan launch' } }],
        },
        view: allRecords,
      });
      fixture.persistWrites();
      const onCellFocus = vi.fn();
      render(() => (
        <DatabaseRecordsView
          name="Projects"
          source={fixture.source}
          canEdit
          view={allRecords}
          stored={false}
          addColumn={() => null}
          onCellFocus={onCellFocus}
          boardPositions={unplacedCards}
        />
      ));
      fireEvent.click(screen.getByRole('button', { name: /Name: Unnamed/ }));
      const name = screen.getByRole('textbox', { name: 'Edit Name' });
      fireEvent.input(name, { target: { value: 'Created from draft' } });
      fireEvent.keyDown(name, { key: 'Enter' });
      await waitFor(() =>
        expect(fixture.source.snapshot()?.rows[1]?.rowId).toBe('created')
      );
      await screen.findByRole('button', { name: 'Open Created from draft' });
      await waitFor(() =>
        expect(
          screen
            .getByRole('button', { name: 'Open Created from draft' })
            .closest('[data-grid-row-id]')
            ?.getAttribute('data-grid-row-id')
        ).toMatch(/^draft:/)
      );
      const draft = screen
        .getByRole('button', { name: 'Open Created from draft' })
        .closest('[data-grid-row-id]')!;
      const first = document.querySelector<HTMLElement>(
        '[data-grid-row-id="row"] [data-grid-column="1"]'
      )!;
      const last = draft.querySelector<HTMLElement>('[data-grid-column="2"]')!;
      first.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, button: 0 })
      );
      document.dispatchEvent(
        new MouseEvent('pointerup', { bubbles: true, button: 0 })
      );
      last.dispatchEvent(
        new MouseEvent('pointerdown', {
          bubbles: true,
          button: 0,
          shiftKey: true,
        })
      );
      if (operation === 'presence') {
        expect(onCellFocus).toHaveBeenLastCalledWith({
          rowId: 'row',
          columnId: 'title',
          endRowId: 'created',
          endColumnId: 'status',
          editing: false,
        });
      } else {
        fireEvent.keyDown(last, { key: 'Delete' });
        await waitFor(() =>
          expect(fixture.source.write).toHaveBeenLastCalledWith(
            {
              kind: 'clear',
              rowIds: ['row', 'created'],
              columnIds: ['title', 'status'],
            },
            2,
            false
          )
        );
        expect(fixture.source.snapshot()?.rows).toEqual([
          { rowId: 'row', cells: { title: null, status: null } },
          { rowId: 'created', cells: { title: null, status: null } },
        ]);
      }
    }
  );

  it('focuses a new column header and edits its cells in a row created from the blank draft', async () => {
    const fixture = createFakeRowsSource({
      columns,
      table: {
        version: 1,
        rows: [
          { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
        ],
      },
      view: allRecords,
    });
    fixture.setColumns([columns[0]]);
    fixture.setTable({ version: 1, rows: [] });
    fixture.persistWrites();
    let actions!: DatabaseRecordsActions;
    render(() => (
      <DatabaseRecordsView
        name="Projects"
        source={fixture.source}
        canEdit
        onRenameColumn={vi.fn(() => okAsync(undefined))}
        view={allRecords}
        stored={false}
        addColumn={() => null}
        actionsRef={(value) => {
          actions = value;
        }}
        boardPositions={unplacedCards}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: /Name: Unnamed/ }));
    const name = screen.getByRole('textbox', { name: 'Edit Name' });
    fireEvent.input(name, { target: { value: 'Created from draft' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    await waitFor(() =>
      expect(fixture.source.snapshot()?.rows[0]?.rowId).toBe('created')
    );
    await screen.findByRole('button', { name: 'Open Created from draft' });

    expect(actions.focusColumn('notes')).toBe(true);
    fixture.setColumns([
      columns[0],
      { ...columns[0], id: 'notes', name: 'Notes' },
    ]);
    const header = await screen.findByRole('textbox', { name: 'Column name' });
    await waitFor(() => expect(document.activeElement).toBe(header));
    expect((header as HTMLInputElement).value).toBe('Notes');
    fireEvent.keyDown(header, { key: 'Escape' });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('columnheader', { name: 'Notes' })
      )
    );
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Notes: Empty. Click to edit' })[0]
    );
    const notes = await screen.findByRole('textbox', { name: 'Edit Notes' });
    await waitFor(() => expect(document.activeElement).toBe(notes));
    fireEvent.input(notes, { target: { value: 'Typed into the new column' } });
    fireEvent.keyDown(notes, { key: 'Enter' });
    await waitFor(() =>
      expect(fixture.source.write).toHaveBeenLastCalledWith(
        {
          kind: 'cell',
          rowId: 'created',
          columnId: 'notes',
          value: 'Typed into the new column',
        },
        2,
        false
      )
    );
    expect(fixture.source.snapshot()?.rows).toHaveLength(1);
    await actions.focusFirstCell();
    const first = await screen.findByRole('textbox', { name: 'Edit Name' });
    expect((first as HTMLInputElement).value).toBe('Created from draft');
    await waitFor(() => expect(document.activeElement).toBe(first));
  });

  it('retries a failed duplicate from its row menu once and focuses the new inline name', async () => {
    const fixture = createFakeRowsSource({
      columns,
      table: {
        version: 1,
        rows: [
          { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
        ],
      },
      view: allRecords,
    });
    fixture.persistWrites();
    vi.mocked(fixture.source.write).mockReturnValueOnce(
      errAsync(lostConnection)
    );
    render(() => (
      <DatabaseRecordsView
        name="Projects"
        source={fixture.source}
        canEdit
        view={allRecords}
        stored={false}
        addColumn={() => null}
        boardPositions={unplacedCards}
      />
    ));
    const duplicate = async () => {
      fireEvent.contextMenu(
        screen.getByRole('button', { name: 'Open Plan launch' })
      );
      const item = await screen.findByRole('menuitem', { name: 'Duplicate' });
      item.focus();
      fireEvent.keyDown(item, { key: 'Enter' });
    };
    await duplicate();
    await screen.findByRole('alert');
    await waitFor(() => expect(fixture.source.write).toHaveBeenCalledTimes(1));
    await duplicate();
    const name = await screen.findByRole('textbox', { name: 'Edit Name' });
    await waitFor(() => expect(document.activeElement).toBe(name));
    expect((name as HTMLInputElement).value).toBe('Plan launch');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(fixture.source.snapshot()?.rows).toHaveLength(2);
    expect(fixture.source.write).toHaveBeenCalledTimes(2);
    expect(fixture.source.write).toHaveBeenLastCalledWith(
      { kind: 'create', values: { title: 'Plan launch', status: 'To do' } },
      1,
      false
    );
  });

  it('confirms a context-menu deletion and retries the same record without leaving a stale failure', async () => {
    const fixture = createFakeRowsSource({
      columns,
      table: {
        version: 1,
        rows: [
          { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
        ],
      },
      view: allRecords,
    });
    fixture.persistWrites();
    fixture.setTable({
      version: 1,
      rows: [
        { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
        {
          rowId: 'other',
          cells: { title: 'Keep this record', status: 'Done' },
        },
      ],
    });
    vi.mocked(fixture.source.write).mockReturnValueOnce(
      errAsync(lostConnection)
    );
    render(() => (
      <DatabaseRecordsView
        name="Projects"
        source={fixture.source}
        canEdit
        view={allRecords}
        stored={false}
        addColumn={() => null}
        boardPositions={unplacedCards}
      />
    ));
    fireEvent.contextMenu(
      screen.getByRole('button', { name: 'Open Plan launch' })
    );
    const item = await screen.findByRole('menuitem', { name: 'Delete record' });
    item.focus();
    fireEvent.keyDown(item, { key: 'Enter' });
    const dialog = await screen.findByRole('dialog', {
      name: 'Delete record?',
    });
    expect(fixture.source.write).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await within(dialog).findByRole('alert');
    fireEvent.click(
      await within(dialog).findByRole('button', { name: 'Delete' })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fixture.source.write).toHaveBeenCalledTimes(2);
    expect(fixture.source.write).toHaveBeenLastCalledWith(
      { kind: 'delete', rowId: 'row' },
      1,
      false
    );
    expect(fixture.source.snapshot()?.rows.map((row) => row.rowId)).toEqual([
      'other',
    ]);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it.each(['draft', 'error banner'])(
    'creates only one card when a failed draft is retried through the %s',
    async (surface) => {
      const fixture = createFakeRowsSource({
        columns,
        table: {
          version: 1,
          rows: [
            { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
          ],
        },
        view: allRecords,
      });
      fixture.persistWrites();
      const commit = vi.mocked(fixture.source.write).getMockImplementation()!;
      let complete!: () => void;
      const pending = new Promise<void>((resolve) => {
        complete = resolve;
      });
      vi.mocked(fixture.source.write)
        .mockReturnValueOnce(errAsync(lostConnection))
        .mockImplementationOnce((mutation, version, createOptions) =>
          ResultAsync.fromSafePromise(pending).andThen(() =>
            commit(mutation, version, createOptions)
          )
        );
      render(() => (
        <DatabaseRecordsView
          name="Projects"
          source={fixture.source}
          canEdit
          view={statusBoard}
          stored
          boardPositions={unplacedCards}
          addColumn={() => <button type="button">Add column</button>}
        />
      ));
      fireEvent.click(
        await screen.findByRole('button', { name: 'Add record to Done' })
      );
      const draft = screen.getByRole('textbox', { name: 'New record title' });
      fireEvent.input(draft, { target: { value: 'One new card' } });
      fireEvent.keyDown(draft, { key: 'Enter' });
      await screen.findByRole('alert');
      const titles = () =>
        screen
          .queryAllByRole('textbox', { name: 'New record title' })
          .map((input) => (input as HTMLTextAreaElement).value);
      await waitFor(() => expect(titles()).toEqual(['One new card', '']));
      if (surface === 'draft')
        fireEvent.keyDown(
          screen.getAllByRole('textbox', { name: 'New record title' })[0],
          { key: 'Enter' }
        );
      else fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await waitFor(() =>
        expect(fixture.source.write).toHaveBeenCalledTimes(2)
      );
      const submitted = screen.getByRole('status', {
        name: 'Saving new record',
      });
      expect(submitted.textContent).toContain('One new card');
      expect(titles()).toEqual(['']);
      fireEvent.keyDown(submitted, { key: 'Escape' });
      expect(screen.getByRole('status', { name: 'Saving new record' })).toBe(
        submitted
      );
      expect(fixture.source.write).toHaveBeenCalledTimes(2);
      complete();
      await screen.findByRole('button', { name: 'Open One new card' });
      await waitFor(() =>
        expect(
          screen.queryByRole('status', { name: 'Saving new record' })
        ).toBeNull()
      );
      expect(titles()).toEqual(['']);
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
      expect(fixture.source.write).toHaveBeenCalledTimes(2);
      expect(
        screen.getAllByRole('button', { name: 'Open One new card' })
      ).toHaveLength(1);
      expect(
        fixture.source.snapshot()?.rows.filter((row) => row.rowId === 'created')
      ).toHaveLength(1);
      if (surface === 'error banner') {
        fireEvent.click(
          screen.getByRole('button', { name: 'Add record to Done' })
        );
        const next = screen.getByRole('textbox', { name: 'New record title' });
        fireEvent.input(next, {
          target: { value: 'A second intentional card' },
        });
        fireEvent.keyDown(next, { key: 'Enter' });
        await screen.findByRole('button', {
          name: 'Open A second intentional card',
        });
        expect(fixture.source.write).toHaveBeenCalledTimes(3);
        expect(
          fixture.source
            .snapshot()
            ?.rows.filter((row) => row.rowId.startsWith('created'))
        ).toHaveLength(2);
      }
    }
  );

  it('reveals a card created outside the filters through its saved notice without creating it again', async () => {
    const fixture = createFakeRowsSource({
      columns,
      table: {
        version: 1,
        rows: [
          { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
        ],
      },
      view: allRecords,
    });
    fixture.setAnswer(() => titleContains('launch'));
    fixture.persistWrites();
    const changeView = vi.fn();
    render(() => (
      <DatabaseRecordsView
        name="Projects"
        source={fixture.source}
        canEdit
        view={{
          ...statusBoard,
          query: {
            filter: {
              conjunction: 'and',
              conditions: [
                {
                  kind: 'condition',
                  column: 'title',
                  test: { kind: 'text', operator: 'contains', value: 'launch' },
                },
              ],
            },
            sort: [],
          },
        }}
        stored
        boardPositions={unplacedCards}
        onViewChange={changeView}
        addColumn={() => <button type="button">Add column</button>}
      />
    ));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Add record to Done' })
    );
    const draft = screen.getByRole('textbox', { name: 'New record title' });
    fireEvent.input(draft, { target: { value: 'Write announcement' } });
    fireEvent.keyDown(draft, { key: 'Enter' });
    await screen.findByText('Record created outside this view');
    expect(
      screen.queryByRole('button', { name: 'Open Write announcement' })
    ).toBeNull();
    await waitFor(() =>
      expect(
        screen.queryByRole('status', { name: 'Saving new record' })
      ).toBeNull()
    );
    expect(
      (
        screen.getByRole('textbox', {
          name: 'New record title',
        }) as HTMLTextAreaElement
      ).value
    ).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Open record' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('heading', { name: 'Write announcement' })
    ).toBeTruthy();
    expect(
      within(dialog).getByText(
        'This record doesn’t match your filters. You can keep editing it here.'
      )
    ).toBeTruthy();
    expect(changeView).not.toHaveBeenCalled();
    expect(fixture.source.write).toHaveBeenCalledTimes(1);
  });

  it('keeps editing a record that stops matching the filters and removes the explanation when it matches again', async () => {
    const fixture = createFakeRowsSource({
      columns,
      table: {
        version: 1,
        rows: [
          { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
        ],
      },
      view: allRecords,
    });
    fixture.setAnswer(() => titleContains('launch'));
    fixture.persistWrites();
    render(() => (
      <DatabaseRecordsView
        name="Projects"
        source={fixture.source}
        canEdit
        view={{
          ...allRecords,
          query: {
            filter: {
              conjunction: 'and',
              conditions: [
                {
                  kind: 'condition',
                  column: 'title',
                  test: { kind: 'text', operator: 'contains', value: 'launch' },
                },
              ],
            },
            sort: [],
          },
        }}
        stored={false}
        addColumn={() => <button type="button">Add column</button>}
        boardPositions={unplacedCards}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Open Plan launch' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.input(screen.getByRole('textbox', { name: 'Edit Name' }), {
      target: { value: 'Ship the project' },
    });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit Name' }), {
      key: 'Enter',
    });
    await within(dialog).findByText(
      'This record doesn’t match your filters. You can keep editing it here.'
    );
    await waitFor(() => expect(fixture.source.write).toHaveBeenCalledTimes(1));
    fireEvent.click(
      within(dialog).getByRole('button', {
        name: 'Name: Ship the project. Click to edit',
      })
    );
    fireEvent.input(screen.getByRole('textbox', { name: 'Edit Name' }), {
      target: { value: 'Launch next week' },
    });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit Name' }), {
      key: 'Enter',
    });
    await waitFor(() =>
      expect(within(dialog).queryByText(/This record doesn’t match/)).toBeNull()
    );
    expect(screen.getByRole('dialog')).toBe(dialog);
  });

  it('keeps an acknowledged new record in the view when its refresh fails, without offering a duplicate create retry', async () => {
    const { source } = createFakeRowsSource({
      columns,
      table: {
        version: 1,
        rows: [
          { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
        ],
      },
      view: allRecords,
    });
    vi.mocked(source.write).mockReturnValue(
      okAsync({ version: 2, insertedRowIds: ['created'] })
    );
    vi.mocked(source.refresh).mockReturnValue(
      errAsync({ kind: 'fetch', message: 'Connection lost' })
    );
    render(() => (
      <DatabaseRecordsView
        name="Projects"
        source={source}
        canEdit
        view={{
          ...allRecords,
          query: {
            filter: {
              conjunction: 'and',
              conditions: [
                {
                  kind: 'condition',
                  column: 'title',
                  test: { kind: 'text', operator: 'contains', value: 'launch' },
                },
              ],
            },
            sort: [],
          },
        }}
        stored={false}
        addColumn={() => <button type="button">Add column</button>}
        boardPositions={unplacedCards}
      />
    ));
    fireEvent.click(
      screen.getByRole('button', { name: 'Name: Unnamed. Click to edit' })
    );
    const draft = await screen.findByRole('textbox', { name: 'Edit Name' });
    fireEvent.input(draft, { target: { value: 'Outside view' } });
    fireEvent.keyDown(draft, { key: 'Enter' });
    // Unread, the engine has not said whether it matches, so it stays put.
    await screen.findByText('The latest data could not be refreshed.');
    expect(screen.queryByText('Record created outside this view')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open Outside view' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('textbox', { name: 'Edit Name' })
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(source.write).toHaveBeenCalledTimes(1);
  });

  it.each([
    { kind: 'editable title', schema: columns, editsTitle: true },
    {
      kind: 'read-only title',
      schema: [{ ...columns[0], writable: false }, columns[1]],
      editsTitle: false,
    },
    { kind: 'no text title', schema: [columns[1]], editsTitle: false },
  ])(
    'focuses an editable draft cell with $kind and only creates after entering a value',
    async ({ schema, editsTitle }) => {
      const fixture = createFakeRowsSource({
        columns,
        table: {
          version: 1,
          rows: [
            { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
          ],
        },
        view: allRecords,
      });
      fixture.setColumns(schema);
      fixture.persistWrites();
      render(() => (
        <DatabaseRecordsView
          name="Projects"
          source={fixture.source}
          canEdit
          view={allRecords}
          stored={false}
          addColumn={() => null}
          renderToolbar={(actions) => (
            <button type="button" onClick={() => void actions.createRecord()}>
              New record
            </button>
          )}
          boardPositions={unplacedCards}
        />
      ));
      fireEvent.click(screen.getByRole('button', { name: 'New record' }));
      expect(fixture.source.write).not.toHaveBeenCalled();
      if (editsTitle) {
        expect(screen.queryByRole('dialog')).toBeNull();
        const name = await screen.findByRole('textbox', { name: 'Edit Name' });
        await waitFor(() => expect(document.activeElement).toBe(name));
        expect((name as HTMLInputElement).value).toBe('');
        expect(screen.getByRole('grid').contains(name)).toBe(true);
        fireEvent.input(name, { target: { value: 'New project' } });
        fireEvent.keyDown(name, { key: 'Enter' });
      } else {
        expect(screen.queryByRole('textbox', { name: /^Edit / })).toBeNull();
        const picker = await screen.findByRole('combobox', {
          name: 'Search Status options',
        });
        // The only dialog is the cell's option picker, not a record panel.
        expect(screen.getByRole('dialog').contains(picker)).toBe(true);
        fireEvent.click(screen.getByRole('option', { name: 'Done' }));
      }
      await waitFor(() =>
        expect(fixture.source.write).toHaveBeenCalledExactlyOnceWith(
          {
            kind: 'create',
            values: editsTitle ? { title: 'New project' } : { status: 'Done' },
          },
          1,
          false
        )
      );
    }
  );

  it.each(['table', 'record panel'])(
    'keeps an active %s editor, draft and focus during row and cloned schema refreshes',
    (surface) => {
      const { source, setTable, setColumns } = createFakeRowsSource({
        columns,
        table: {
          version: 1,
          rows: [
            { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
          ],
        },
        view: allRecords,
      });
      render(() => (
        <DatabaseRecordsView
          name="Projects"
          source={source}
          canEdit
          view={allRecords}
          stored={false}
          addColumn={() => <button type="button">Add property</button>}
          boardPositions={unplacedCards}
        />
      ));
      if (surface === 'record panel')
        fireEvent.click(
          screen.getByRole('button', { name: 'Open Plan launch' })
        );
      if (surface === 'table')
        fireEvent.click(
          screen.getByRole('button', { name: /Name: Plan launch/ })
        );
      const editor = screen.getByRole('textbox', {
        name: 'Edit Name',
      }) as HTMLInputElement;
      fireEvent.input(editor, { target: { value: 'My unsaved title' } });
      setTable({
        version: 2,
        rows: [
          {
            rowId: 'row',
            cells: { title: 'Changed remotely', status: 'Done' },
          },
        ],
      });
      setColumns(
        columns.map((column) => ({ ...column, options: [...column.options] }))
      );
      expect(screen.getByRole('textbox', { name: 'Edit Name' })).toBe(editor);
      expect(editor.value).toBe('My unsaved title');
      expect(document.activeElement).toBe(editor);
    }
  );

  it('keeps the title property for card titles and new writes when cards show no other fields', async () => {
    const { source } = createFakeRowsSource({
      columns,
      table: {
        version: 1,
        rows: [
          { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
        ],
      },
      view: allRecords,
    });
    render(() => (
      <DatabaseRecordsView
        name="Projects"
        source={source}
        canEdit
        view={statusBoard}
        stored
        boardPositions={unplacedCards}
        addColumn={() => <button type="button">Add property</button>}
      />
    ));
    expect(
      await screen.findByRole('button', { name: 'Open Plan launch' })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add record to Done' }));
    const draft = screen.getByRole('textbox', { name: 'New record title' });
    fireEvent.input(draft, { target: { value: 'New launch' } });
    fireEvent.keyDown(draft, { key: 'Enter' });
    await waitFor(() =>
      expect(source.write).toHaveBeenCalledWith(
        { kind: 'create', values: { status: 'Done', title: 'New launch' } },
        1,
        false
      )
    );
  });

  it.each([
    {
      dataType: 'SELECT_STRING' as const,
      name: 'Status',
      option: { id: 'done', label: 'Done', color: null },
    },
    {
      dataType: 'SELECT_NUMBER' as const,
      name: 'Priority',
      option: { id: 'two', label: '2', color: null },
    },
  ])(
    'creates a $dataType-only card without writing a title into its grouping field',
    async ({ dataType, name, option }) => {
      const { source, setColumns, setTable } = createFakeRowsSource({
        columns,
        table: {
          version: 1,
          rows: [
            { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
          ],
        },
        view: allRecords,
      });
      setColumns([
        {
          id: 'group',
          name,
          dataType,
          options: [option],
          isMultiSelect: false,
          writable: true,
        },
      ]);
      setTable({ version: 1, rows: [] });
      render(() => (
        <DatabaseRecordsView
          name="Projects"
          source={source}
          canEdit
          view={{
            ...allRecords,
            layout: {
              kind: 'board',
              title: 'title',
              groupBy: 'group',
              lanes: [
                { key: { kind: 'option', id: option.id }, hidden: false },
              ],
              cardFields: [],
              hideEmptyLanes: false,
            },
          }}
          stored
          boardPositions={unplacedCards}
          addColumn={() => <button type="button">Add property</button>}
        />
      ));
      fireEvent.click(
        await screen.findByRole('button', {
          name: `Add record to ${option.label}`,
        })
      );
      expect(
        screen.queryByRole('textbox', { name: 'New record title' })
      ).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Add record' }));
      await waitFor(() =>
        expect(source.write).toHaveBeenCalledWith(
          { kind: 'create', values: { group: option.label } },
          1,
          false
        )
      );
    }
  );

  it('starts an inline card in the first lane when the toolbar adds a record to a board', async () => {
    const { source } = createFakeRowsSource({
      columns,
      table: {
        version: 1,
        rows: [
          { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
        ],
      },
      view: allRecords,
    });
    render(() => (
      <DatabaseRecordsView
        name="Projects"
        source={source}
        canEdit
        view={statusBoard}
        stored
        boardPositions={unplacedCards}
        addColumn={() => <button type="button">Add property</button>}
        renderToolbar={(actions) => (
          <button type="button" onClick={() => void actions.createRecord()}>
            New record
          </button>
        )}
      />
    ));
    await screen.findByRole('region', { name: 'Done lane' });
    fireEvent.click(screen.getByText('New record', { selector: 'button' }));
    const lanes = screen.getAllByRole('region');
    expect(lanes[0].getAttribute('aria-label')).toBe('Done lane');
    const draft = within(lanes[0]).getByRole('textbox', {
      name: 'New record title',
    });
    expect(document.activeElement).toBe(draft);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(source.write).not.toHaveBeenCalled();
    fireEvent.input(draft, { target: { value: 'From the toolbar' } });
    fireEvent.keyDown(draft, { key: 'Enter' });
    await waitFor(() =>
      expect(source.write).toHaveBeenCalledWith(
        {
          kind: 'create',
          values: { status: 'Done', title: 'From the toolbar' },
        },
        1,
        false
      )
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('creates a card without writing a read-only string title', async () => {
    const { source, setColumns } = createFakeRowsSource({
      columns,
      table: {
        version: 1,
        rows: [
          { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
        ],
      },
      view: allRecords,
    });
    setColumns([{ ...columns[0], writable: false }, columns[1]]);
    render(() => (
      <DatabaseRecordsView
        name="Projects"
        source={source}
        canEdit
        view={statusBoard}
        stored
        boardPositions={unplacedCards}
        addColumn={() => <button type="button">Add property</button>}
      />
    ));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Add record to Done' })
    );
    expect(
      screen.queryByRole('textbox', { name: 'New record title' })
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add record' }));
    await waitFor(() =>
      expect(source.write).toHaveBeenCalledWith(
        { kind: 'create', values: { status: 'Done' } },
        1,
        false
      )
    );
  });

  it('shows save failures and a working retry inside the record panel', async () => {
    const { source } = createFakeRowsSource({
      columns,
      table: {
        version: 1,
        rows: [
          { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
        ],
      },
      view: allRecords,
    });
    vi.mocked(source.write).mockReturnValueOnce(errAsync(lostConnection));
    render(() => (
      <DatabaseRecordsView
        name="Projects"
        source={source}
        canEdit
        view={allRecords}
        stored={false}
        addColumn={() => <button type="button">Add property</button>}
        boardPositions={unplacedCards}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Open Plan launch' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.input(screen.getByRole('textbox', { name: 'Edit Name' }), {
      target: { value: 'Updated launch' },
    });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit Name' }), {
      key: 'Enter',
    });
    await waitFor(() => expect(dialog.textContent).toContain('was not saved'));
    await waitFor(() =>
      expect(dialog.textContent).toContain('Change not saved')
    );
    fireEvent.click(
      Array.from(dialog.querySelectorAll('button')).find(
        (button) => button.textContent === 'Retry'
      )!
    );
    await waitFor(() => expect(source.write).toHaveBeenCalledTimes(2));
  });

  it('says a change was not saved only in the panel of the record it was made to', async () => {
    const { source } = createFakeRowsSource({
      columns,
      table: {
        version: 1,
        rows: [
          { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
          { rowId: 'other', cells: { title: 'Hire team', status: 'Done' } },
        ],
      },
      view: allRecords,
    });
    vi.mocked(source.write).mockReturnValueOnce(errAsync(lostConnection));
    render(() => (
      <DatabaseRecordsView
        name="Projects"
        source={source}
        canEdit
        view={allRecords}
        stored={false}
        addColumn={() => null}
        boardPositions={unplacedCards}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: /Name: Hire team/ }));
    const input = screen.getByRole('textbox', { name: 'Edit Name' });
    fireEvent.input(input, { target: { value: 'Hire a team' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText('Could not save Name.');
    fireEvent.click(screen.getByRole('button', { name: 'Open Plan launch' }));
    const planLaunch = await screen.findByRole('dialog', {
      name: 'Plan launch',
    });
    expect(planLaunch.textContent).not.toContain('was not saved');
    fireEvent.keyDown(planLaunch, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /^Open Hire/ }));
    const hireTeam = await screen.findByRole('dialog');
    expect(hireTeam.textContent).toContain(
      'Your change to Name was not saved.'
    );
  });

  it('uses an explicit first-property action when the table has no schema', () => {
    const { source, setTable } = createFakeRowsSource({
      columns,
      table: {
        version: 1,
        rows: [
          { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
        ],
      },
      view: allRecords,
    });
    source.columns = () => [];
    setTable({ version: 1, rows: [] });
    render(() => (
      <DatabaseRecordsView
        name="Projects"
        source={source}
        canEdit
        view={allRecords}
        stored={false}
        addColumn={(label) => (
          <button type="button">{label ?? 'Add property'}</button>
        )}
        boardPositions={unplacedCards}
      />
    ));
    expect(
      screen.getByRole('button', { name: 'Add first column' })
    ).toBeTruthy();
  });

  it('deletes the record open in the panel after confirmation', async () => {
    const { source, setTable } = createFakeRowsSource({
      columns,
      table: {
        version: 1,
        rows: [
          { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
        ],
      },
      view: allRecords,
    });
    setTable({
      version: 1,
      rows: [
        { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
        {
          rowId: 'next',
          cells: { title: 'Write announcement', status: 'Done' },
        },
      ],
    });
    render(() => (
      <DatabaseRecordsView
        name="Projects"
        source={source}
        canEdit
        view={allRecords}
        stored={false}
        addColumn={() => <button type="button">Add property</button>}
        boardPositions={unplacedCards}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Open Plan launch' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next record' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete record' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Delete record?',
    });
    expect(source.write).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(source.write).toHaveBeenCalledWith(
        { kind: 'delete', rowId: 'next' },
        1,
        false
      )
    );
    expect(source.write).toHaveBeenCalledTimes(1);
  });

  it('makes column sorting explicit and supplies record creation to the toolbar', async () => {
    const { source } = createFakeRowsSource({
      columns,
      table: {
        version: 1,
        rows: [
          { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
        ],
      },
      view: allRecords,
    });
    const changeView = vi.fn();
    render(() => (
      <DatabaseRecordsView
        name="Projects"
        source={source}
        canEdit
        view={allRecords}
        stored={false}
        onViewChange={changeView}
        addColumn={() => <button type="button">Add column</button>}
        renderToolbar={(actions) => (
          <button
            type="button"
            disabled={actions.pending()}
            onClick={() => void actions.createRecord()}
          >
            Create from toolbar
          </button>
        )}
        boardPositions={unplacedCards}
      />
    ));
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Name column menu' }),
      { key: 'Enter' }
    );
    expect(changeView).not.toHaveBeenCalled();
    fireEvent.keyDown(
      await screen.findByRole('menuitem', { name: 'Sort descending' }),
      { key: 'Enter' }
    );
    expect(changeView).toHaveBeenCalledWith({
      query: {
        filter: null,
        sort: [{ column: 'title', direction: 'descending' }],
      },
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Create from toolbar' })
    );
    const draft = await screen.findByRole('textbox', { name: 'Edit Name' });
    await waitFor(() => expect(document.activeElement).toBe(draft));
    expect(source.write).not.toHaveBeenCalled();
    fireEvent.input(draft, { target: { value: 'Toolbar entry' } });
    fireEvent.keyDown(draft, { key: 'Enter' });
    await waitFor(() =>
      expect(source.write).toHaveBeenCalledExactlyOnceWith(
        { kind: 'create', values: { title: 'Toolbar entry' } },
        1,
        false
      )
    );
  });

  it('persists menu moves past the neighboring column in both directions', async () => {
    const { source, setColumns } = createFakeRowsSource({
      columns,
      table: {
        version: 1,
        rows: [
          { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
        ],
      },
      view: allRecords,
    });
    setColumns([...columns, { ...columns[0], id: 'notes', name: 'Notes' }]);
    const [view, setView] = createSignal<DatabaseView>({
      ...allRecords,
      layout: {
        kind: 'table',
        columns: [
          { column: 'title', width: null },
          { column: 'status', width: null },
          { column: 'notes', width: null },
        ],
      },
    });
    const reorder = vi.fn((_order: string[]) => okAsync(undefined));
    render(() => (
      <DatabaseRecordsView
        name="Projects"
        source={source}
        canEdit
        view={view()}
        stored={false}
        onViewChange={(change) =>
          setView((current) => ({ ...current, ...change }))
        }
        onReorderColumns={reorder}
        addColumn={() => null}
        boardPositions={unplacedCards}
      />
    ));
    const moveName = async (direction: 'left' | 'right') => {
      fireEvent.keyDown(
        screen.getByRole('button', { name: 'Name column menu' }),
        {
          key: 'Enter',
        }
      );
      fireEvent.keyDown(
        await screen.findByRole('menuitem', { name: `Move ${direction}` }),
        {
          key: 'Enter',
        }
      );
    };
    await moveName('right');
    await waitFor(() =>
      expect(view().layout).toEqual({
        kind: 'table',
        columns: [
          { column: 'status', width: null },
          { column: 'title', width: null },
          { column: 'notes', width: null },
        ],
      })
    );
    await waitFor(() =>
      expect(reorder).toHaveBeenNthCalledWith(1, ['status', 'title', 'notes'])
    );
    await moveName('left');
    await waitFor(() =>
      expect(view().layout).toEqual({
        kind: 'table',
        columns: [
          { column: 'title', width: null },
          { column: 'status', width: null },
          { column: 'notes', width: null },
        ],
      })
    );
    await waitFor(() =>
      expect(reorder).toHaveBeenNthCalledWith(2, ['title', 'status', 'notes'])
    );
    expect(source.write).not.toHaveBeenCalled();
  });

  it('moves the columns of a stored view in its own layout without reordering the table', async () => {
    const { source, setColumns } = createFakeRowsSource({
      columns,
      table: {
        version: 1,
        rows: [
          { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
        ],
      },
      view: allRecords,
    });
    setColumns([...columns, { ...columns[0], id: 'notes', name: 'Notes' }]);
    const changeView = vi.fn();
    const reorder = vi.fn((_order: string[]) => okAsync(undefined));
    render(() => (
      <DatabaseRecordsView
        name="Projects"
        source={source}
        canEdit
        view={{
          ...allRecords,
          layout: {
            kind: 'table',
            columns: [
              { column: 'title', width: 240 },
              { column: 'status', width: null },
              { column: 'notes', width: null },
            ],
          },
        }}
        stored
        onViewChange={changeView}
        onReorderColumns={reorder}
        addColumn={() => null}
        boardPositions={unplacedCards}
      />
    ));
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Name column menu' }),
      { key: 'Enter' }
    );
    fireEvent.keyDown(
      await screen.findByRole('menuitem', { name: 'Move right' }),
      { key: 'Enter' }
    );
    expect(changeView).toHaveBeenCalledExactlyOnceWith({
      layout: {
        kind: 'table',
        columns: [
          { column: 'status', width: null },
          { column: 'title', width: 240 },
          { column: 'notes', width: null },
        ],
      },
    });
    expect(reorder).not.toHaveBeenCalled();
  });

  it('moves immediately and serializes rapid column drops without snapping back on older completion', async () => {
    const fixture = columnOrderFixture();
    await fixture.moveName('right');
    expect(fixture.headers()).toEqual([
      'Notes column menu',
      'Name column menu',
      'Owner column menu',
    ]);
    await fixture.moveName('right');
    expect(fixture.headers()).toEqual([
      'Notes column menu',
      'Owner column menu',
      'Name column menu',
    ]);
    expect(fixture.reorder).toHaveBeenCalledTimes(1);
    expect(fixture.reorder).toHaveBeenNthCalledWith(1, [
      'notes',
      'title',
      'owner',
    ]);

    fixture.requests[0].resolve();
    await waitFor(() => expect(fixture.requests).toHaveLength(2));
    expect(fixture.reorder).toHaveBeenNthCalledWith(2, [
      'notes',
      'owner',
      'title',
    ]);
    expect(fixture.headers()).toEqual([
      'Notes column menu',
      'Owner column menu',
      'Name column menu',
    ]);
    fixture.requests[1].resolve();
    expect(fixture.changeView).toHaveBeenCalledTimes(2);
  });

  it('rolls a rejected final drop back to the last saved order without losing other view edits', async () => {
    const fixture = columnOrderFixture();
    await fixture.moveName('right');
    await fixture.moveName('right');
    fixture.requests[0].resolve();
    await waitFor(() => expect(fixture.requests).toHaveLength(2));
    fixture.setView({
      ...fixture.view(),
      query: {
        filter: null,
        sort: [{ column: 'title', direction: 'ascending' }],
      },
    });
    fixture.requests[1].reject({
      code: 'INVALID_OP',
      message: 'This table changed. Try again.',
      refusal: null,
    });
    await screen.findByRole('alert');
    expect(fixture.view().layout).toEqual({
      kind: 'table',
      columns: [
        { column: 'notes', width: null },
        { column: 'title', width: null },
        { column: 'owner', width: null },
      ],
    });
    expect(fixture.view().query).toEqual({
      filter: null,
      sort: [{ column: 'title', direction: 'ascending' }],
    });
    expect(fixture.headers()).toEqual([
      'Notes column menu',
      'Name column menu',
      'Owner column menu',
    ]);
  });

  it('restores the original order when every queued column move fails', async () => {
    const fixture = columnOrderFixture();
    await fixture.moveName('right');
    await fixture.moveName('right');
    fixture.requests[0].reject({
      code: 'INVALID_OP',
      message: 'First save failed',
      refusal: null,
    });
    await waitFor(() => expect(fixture.requests).toHaveLength(2));
    expect(fixture.headers()).toEqual([
      'Notes column menu',
      'Owner column menu',
      'Name column menu',
    ]);
    fixture.requests[1].reject({
      code: 'INVALID_OP',
      message: 'Final save failed',
      refusal: null,
    });
    await screen.findByText('Final save failed');
    expect(fixture.view().layout).toEqual({
      kind: 'table',
      columns: [
        { column: 'title', width: null },
        { column: 'notes', width: null },
        { column: 'owner', width: null },
      ],
    });
  });

  it('does not overwrite a newly selected layout when a pending reorder fails', async () => {
    const fixture = columnOrderFixture();
    await fixture.moveName('right');
    const selected: DatabaseView = {
      ...allRecords,
      id: 'by-owner',
      name: 'By owner',
      layout: {
        kind: 'table',
        columns: [
          { column: 'owner', width: null },
          { column: 'title', width: null },
          { column: 'notes', width: null },
          { column: 'status', width: null },
        ],
      },
    };
    fixture.setView(selected);
    fixture.changeView.mockClear();
    fixture.requests[0].reject({
      code: 'INVALID_OP',
      message: 'Save failed',
      refusal: null,
    });
    await screen.findByText('Save failed');
    expect(fixture.changeView).not.toHaveBeenCalled();
    expect(fixture.view()).toEqual(selected);
  });

  it('lets viewers move columns in their own layout without writing the table', async () => {
    const { source, setColumns, setTable } = createFakeRowsSource({
      columns,
      table: {
        version: 1,
        rows: [
          { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
        ],
      },
      view: allRecords,
    });
    setColumns([...columns, { ...columns[0], id: 'notes', name: 'Notes' }]);
    setTable({
      version: 1,
      rows: [
        {
          rowId: 'row',
          cells: {
            title: 'Plan launch',
            status: 'To do',
            notes: 'Important context',
          },
        },
      ],
    });
    const [view, setView] = createSignal<DatabaseView>({
      ...allRecords,
      layout: {
        kind: 'table',
        columns: [
          { column: 'title', width: null },
          { column: 'status', width: null },
          { column: 'notes', width: null },
        ],
      },
    });
    const changeView = (change: ViewChange) =>
      setView((current) => ({ ...current, ...change }));
    render(() => (
      <DatabaseRecordsView
        name="Projects"
        source={source}
        canEdit={false}
        view={view()}
        stored={false}
        onViewChange={changeView}
        addColumn={() => null}
        boardPositions={unplacedCards}
      />
    ));
    const headers = () =>
      screen
        .getAllByRole('button', { name: / column menu$/ })
        .map((button) => button.getAttribute('aria-label'));
    const openMenu = (name: string) =>
      fireEvent.keyDown(
        screen.getByRole('button', { name: `${name} column menu` }),
        { key: 'Enter' }
      );
    openMenu('Name');
    expect(
      (await screen.findByRole('menuitem', { name: 'Move left' })).getAttribute(
        'aria-disabled'
      )
    ).toBe('true');
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Move right' }), {
      key: 'Enter',
    });
    await waitFor(() =>
      expect(headers()).toEqual([
        'Status column menu',
        'Name column menu',
        'Notes column menu',
      ])
    );
    expect(view().layout).toEqual({
      kind: 'table',
      columns: [
        { column: 'status', width: null },
        { column: 'title', width: null },
        { column: 'notes', width: null },
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open Plan launch' }));
    const record = await screen.findByRole('dialog');
    expect(
      within(record).getByRole('button', { name: 'Name: Plan launch' })
    ).toBeTruthy();
    expect(within(record).getByText('Status')).toBeTruthy();
    fireEvent.click(
      within(record).getByRole('button', { name: 'Close record' })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expect(source.write).not.toHaveBeenCalled();
  });

  it('lets an empty Name-only table create its first record directly below the headers', async () => {
    const fixture = createFakeRowsSource({
      columns,
      table: {
        version: 1,
        rows: [
          { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
        ],
      },
      view: allRecords,
    });
    fixture.setColumns([columns[0]]);
    fixture.setTable({ version: 1, rows: [] });
    fixture.persistWrites();
    render(() => (
      <DatabaseRecordsView
        name="Playground"
        source={fixture.source}
        canEdit
        view={allRecords}
        stored={false}
        addColumn={() => <button type="button">Add column</button>}
        renderToolbar={(actions) => (
          <button type="button" onClick={() => void actions.createRecord()}>
            New record
          </button>
        )}
        boardPositions={unplacedCards}
      />
    ));
    expect(
      screen.getByRole('button', { name: 'Name column menu' })
    ).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'New record' })).toHaveLength(
      1
    );
    expect(fixture.source.snapshot()?.rows).toHaveLength(0);
    fireEvent.click(
      within(screen.getByRole('grid', { name: 'Playground' })).getByRole(
        'button',
        { name: 'Name: Unnamed. Click to edit' }
      )
    );
    const name = await screen.findByRole('textbox', { name: 'Edit Name' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('grid').contains(name)).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(name));
    expect(fixture.source.write).not.toHaveBeenCalled();
    fireEvent.input(name, { target: { value: 'First record' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    await waitFor(() =>
      expect(fixture.source.snapshot()?.rows).toHaveLength(1)
    );
    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: /Name: First record/ })
      ).toHaveLength(1)
    );
    expect(
      screen.getByRole('button', { name: 'Name: Unnamed. Click to edit' })
    ).toBeTruthy();
    expect(fixture.source.write).toHaveBeenCalledExactlyOnceWith(
      { kind: 'create', values: { title: 'First record' } },
      1,
      false
    );
  });
});
