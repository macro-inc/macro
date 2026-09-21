import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseToolbar } from '../components/database-toolbar';
import {
  type DatabaseRowsSnapshot,
  type DatabaseRowsSource,
  DatabaseWriteOutcomeUnknown,
} from '../context/table-source';
import {
  type DatabaseViewColumn,
  type DatabaseViewConfig,
  defaultDatabaseView,
} from '../core/database-view';
import {
  type DatabaseTableActions,
  DatabaseTableView,
} from './database-table-view';

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
    options: ['To do', 'Done'],
    writable: true,
  },
];

function sourceFixture() {
  const [viewColumns, setColumns] = createSignal(columns);
  const [snapshot, setSnapshot] = createSignal<DatabaseRowsSnapshot>({
    version: 1,
    rows: [{ rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } }],
  });
  const source: DatabaseRowsSource = {
    columns: viewColumns,
    snapshot,
    loading: () => false,
    refreshing: () => false,
    error: () => undefined,
    refresh: vi.fn(async () => {}),
    write: vi.fn(async () => ({ version: 2, insertedRowIds: [] })),
    addOption: vi.fn(async () => {}),
  };
  return { source, setSnapshot, setColumns };
}

function persistWrites({
  source,
  setSnapshot,
}: ReturnType<typeof sourceFixture>) {
  let createdCount = 0;
  vi.mocked(source.write).mockImplementation(async (mutation) => {
    const snapshot = source.snapshot()!;
    const version = (snapshot.version ?? 0) + 1;
    const insertedRowIds =
      mutation.kind === 'create'
        ? [++createdCount === 1 ? 'created' : `created-${createdCount}`]
        : [];
    const rows =
      mutation.kind === 'create'
        ? [
            ...snapshot.rows,
            { rowId: insertedRowIds[0], cells: mutation.values },
          ]
        : snapshot.rows.flatMap((row) => {
            if (row.rowId !== mutation.rowId) return [row];
            if (mutation.kind === 'delete') return [];
            return [
              {
                ...row,
                cells: { ...row.cells, [mutation.columnId]: mutation.value },
              },
            ];
          });
    setSnapshot({ version, rows });
    return { version, insertedRowIds };
  });
}

function deferWrites(source: DatabaseRowsSource) {
  const writes: { resolve: () => void; reject: (error: Error) => void }[] = [];
  vi.mocked(source.write).mockImplementation(
    (_mutation, version) =>
      new Promise((resolve, reject) => {
        writes.push({
          resolve: () =>
            resolve({ version: (version ?? 0) + 1, insertedRowIds: [] }),
          reject,
        });
      })
  );
  return writes;
}

function columnOrderFixture() {
  const { source, setColumns } = sourceFixture();
  setColumns([
    ...columns,
    { ...columns[0], id: 'notes', name: 'Notes' },
    { ...columns[0], id: 'owner', name: 'Owner' },
  ]);
  const [view, setView] = createSignal<DatabaseViewConfig>({
    ...defaultDatabaseView(),
    hiddenColumns: ['status'],
  });
  const changeView = vi.fn((value: DatabaseViewConfig) => setView(value));
  const requests: { resolve: () => void; reject: (error: Error) => void }[] =
    [];
  const reorder = vi.fn(
    (_order: string[]) =>
      new Promise<void>((resolve, reject) => requests.push({ resolve, reject }))
  );
  const mounted = render(() => (
    <DatabaseTableView
      name="Projects"
      source={source}
      canEdit
      view={view()}
      onViewChange={changeView}
      onReorderColumns={reorder}
      addColumn={() => null}
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

function cardPlacementFixture(sorted = false) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      const lane = this.closest<HTMLElement>('[data-kanban-lane]');
      if (!lane) return new DOMRect(0, 0, 1000, 800);
      const x =
        lane.getAttribute('aria-label') === 'Done lane'
          ? 0
          : lane.getAttribute('aria-label') === 'To do lane'
            ? 320
            : 640;
      if (this.hasAttribute('data-kanban-card')) {
        const index = [...lane.querySelectorAll('[data-kanban-card]')].indexOf(
          this
        );
        return new DOMRect(x + 10, 70 + index * 120, 270, 100);
      }
      return new DOMRect(x, 20, 290, 500);
    }
  );
  const fixture = sourceFixture();
  fixture.setSnapshot({
    version: 1,
    rows: [
      { rowId: 'alpha', cells: { title: 'Alpha', status: 'Done' } },
      { rowId: 'zeta', cells: { title: 'Zeta', status: 'Done' } },
      { rowId: 'row', cells: { title: 'Middle', status: 'To do' } },
    ],
  });
  const [view, setView] = createSignal<DatabaseViewConfig>({
    ...defaultDatabaseView(),
    layout: 'board',
    groupBy: 'status',
    sorts: sorted ? [{ columnId: 'title', direction: 'desc' }] : [],
  });
  render(() => (
    <DatabaseTableView
      name="Projects"
      source={fixture.source}
      canEdit
      view={view()}
      onViewChange={setView}
      addColumn={() => null}
    />
  ));
  const drop = (rowId: string, x: number, y: number) => {
    const card = document.querySelector<HTMLElement>(
      `[data-kanban-card="${rowId}"]`
    )!;
    const bounds = card.getBoundingClientRect();
    fireEvent.mouseDown(card.querySelector('button')!, {
      button: 0,
      clientX: bounds.left + 30,
      clientY: bounds.top + 30,
    });
    fireEvent.mouseMove(document, { clientX: x, clientY: y });
    fireEvent.mouseUp(document, { button: 0, clientX: x, clientY: y });
  };
  const cards = (lane = 'Done') =>
    [
      ...screen
        .getByRole('region', { name: `${lane} lane` })
        .querySelectorAll<HTMLElement>('[data-kanban-card]'),
    ].map((card) => card.dataset.kanbanCard);
  return { ...fixture, view, setView, drop, cards };
}

beforeEach(() => {
  const style = document.createElement('style');
  style.textContent = '[role="menu"] { animation-name: none; }';
  document.head.append(style);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
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

describe('manual board placement', () => {
  it('places in the pointer gap immediately and preserves that position while the group save finishes', async () => {
    const { source, view, drop, cards } = cardPlacementFixture(true);
    let finish!: () => void;
    vi.mocked(source.write).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ version: 2, insertedRowIds: [] });
        })
    );
    expect(cards()).toEqual(['zeta', 'alpha']);
    drop('row', 100, 200);
    expect(cards()).toEqual(['zeta', 'row', 'alpha']);
    expect(view().sorts).toEqual([]);
    await waitFor(() => expect(source.write).toHaveBeenCalledOnce());
    // The optimistic card can be moved again before its first write completes.
    drop('row', 100, 75);
    expect(cards()).toEqual(['row', 'zeta', 'alpha']);
    finish();
    await waitFor(() =>
      expect(
        document
          .querySelector('[data-kanban-card="row"]')
          ?.getAttribute('aria-busy')
      ).toBe('false')
    );
    expect(cards()).toEqual(['row', 'zeta', 'alpha']);
    expect(source.write).toHaveBeenCalledOnce();
  });

  it('reorders inside a lane without changing record values', () => {
    const { source, view, drop, cards } = cardPlacementFixture();
    drop('zeta', 100, 75);
    expect(cards()).toEqual(['zeta', 'alpha']);
    expect(view().cardOrder?.['value:"Done"']).toEqual(['zeta', 'alpha']);
    expect(source.write).not.toHaveBeenCalled();
  });

  it('keeps the latest destination when the same pending card is dragged again', async () => {
    const { source, drop, cards } = cardPlacementFixture();
    const saves: (() => void)[] = [];
    vi.mocked(source.write).mockImplementation(
      (_mutation, version) =>
        new Promise((resolve) => {
          saves.push(() =>
            resolve({ version: (version ?? 0) + 1, insertedRowIds: [] })
          );
        })
    );
    drop('row', 100, 200);
    await waitFor(() => expect(source.write).toHaveBeenCalledOnce());
    drop('row', 400, 80);
    expect(cards('To do')).toEqual(['row']);
    expect(cards()).toEqual(['alpha', 'zeta']);
    saves[0]();
    await waitFor(() => expect(source.write).toHaveBeenCalledTimes(2));
    expect(cards('To do')).toEqual(['row']);
    saves[1]();
    await waitFor(() =>
      expect(
        document
          .querySelector('[data-kanban-card="row"]')
          ?.getAttribute('aria-busy')
      ).toBe('false')
    );
    expect(cards('To do')).toEqual(['row']);
    expect(
      vi
        .mocked(source.write)
        .mock.calls.map(([mutation, version]) => [
          mutation.kind === 'cell' && mutation.value,
          version,
        ])
    ).toEqual([
      ['Done', 1],
      ['To do', 2],
    ]);
  });

  it('restores the original lane and ordering when a cross-lane write fails', async () => {
    const { source, view, drop, cards } = cardPlacementFixture(true);
    vi.mocked(source.write).mockRejectedValue(new Error('Connection lost'));
    drop('row', 100, 200);
    expect(cards()).toEqual(['zeta', 'row', 'alpha']);
    await screen.findByRole('alert');
    await waitFor(() => expect(cards('To do')).toEqual(['row']));
    expect(cards()).toEqual(['zeta', 'alpha']);
    expect(view().sorts).toEqual([{ columnId: 'title', direction: 'desc' }]);
    expect(view().cardOrder).toBeUndefined();
  });

  it('restores the original sort and stored positions when every queued move fails', async () => {
    const { source, view, setView, drop, cards } = cardPlacementFixture(true);
    const originalOrder = {
      'value:"Done"': ['alpha', 'hidden', 'zeta'],
      'value:"To do"': ['row'],
    };
    setView((view) => ({ ...view, cardOrder: originalOrder }));
    const writes = deferWrites(source);
    drop('row', 100, 200);
    await waitFor(() => expect(writes).toHaveLength(1));
    drop('row', 400, 80);
    writes[0].reject(new Error('First move rejected'));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(view().sorts).toEqual([]);
    writes[1].reject(new Error('Second move rejected'));
    await waitFor(() =>
      expect(view().sorts).toEqual([{ columnId: 'title', direction: 'desc' }])
    );
    expect(view().cardOrder).toEqual(originalOrder);
    expect(cards()).toEqual(['zeta', 'alpha']);
    expect(cards('To do')).toEqual(['row']);
  });

  it('restores the last successful move when a later queued move fails', async () => {
    const { source, view, drop, cards } = cardPlacementFixture(true);
    const writes = deferWrites(source);
    drop('row', 100, 200);
    const savedOrder = view().cardOrder;
    await waitFor(() => expect(writes).toHaveLength(1));
    drop('row', 400, 80);
    writes[0].resolve();
    await waitFor(() => expect(writes).toHaveLength(2));
    writes[1].reject(new Error('Second move rejected'));
    await waitFor(() => expect(view().cardOrder).toBe(savedOrder));
    expect(view().sorts).toEqual([]);
    expect(cards()).toEqual(['zeta', 'row', 'alpha']);
    expect(cards('To do')).toEqual([]);
  });

  it('keeps a newer same-lane placement after an older success and a later failed move', async () => {
    const { source, view, drop, cards } = cardPlacementFixture(true);
    const writes = deferWrites(source);
    drop('row', 100, 200);
    await waitFor(() => expect(writes).toHaveLength(1));
    drop('row', 100, 75);
    const manualOrder = view().cardOrder;
    expect(cards()).toEqual(['row', 'zeta', 'alpha']);
    drop('row', 400, 80);
    writes[0].resolve();
    await waitFor(() => expect(writes).toHaveLength(2));
    writes[1].reject(new Error('Later move rejected'));
    await waitFor(() => expect(view().cardOrder).toBe(manualOrder));
    expect(view().sorts).toEqual([]);
    expect(cards()).toEqual(['row', 'zeta', 'alpha']);
  });

  it('preserves grouping changed while queued moves fail', async () => {
    const { source, view, setView, setColumns, drop } =
      cardPlacementFixture(true);
    setColumns([
      ...columns,
      { ...columns[1], id: 'priority', name: 'Priority' },
    ]);
    const writes = deferWrites(source);
    drop('row', 100, 200);
    await waitFor(() => expect(writes).toHaveLength(1));
    drop('row', 400, 80);
    setView((view) => ({ ...view, groupBy: 'priority', cardOrder: undefined }));
    writes[0].reject(new Error('First move rejected'));
    await waitFor(() => expect(writes).toHaveLength(2));
    writes[1].reject(new Error('Second move rejected'));
    await waitFor(() =>
      expect(
        document
          .querySelector('[data-kanban-card="row"]')
          ?.getAttribute('aria-busy')
      ).toBe('false')
    );
    expect(view().groupBy).toBe('priority');
    expect(view().sorts).toEqual([]);
    expect(view().cardOrder).toBeUndefined();
  });

  it('preserves a sort selected while an earlier card move fails', async () => {
    const { source, view, setView, drop } = cardPlacementFixture();
    let reject!: (error: Error) => void;
    vi.mocked(source.write).mockImplementation(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        })
    );
    drop('row', 100, 200);
    await waitFor(() => expect(source.write).toHaveBeenCalledOnce());
    setView((view) => ({
      ...view,
      sorts: [{ columnId: 'title', direction: 'asc' }],
    }));
    reject(new Error('Connection lost'));
    await screen.findByRole('alert');
    expect(view().sorts).toEqual([{ columnId: 'title', direction: 'asc' }]);
  });
});

describe('database table view', () => {
  it('offers refresh and draft recovery after a lost create response without a duplicate Retry', async () => {
    const fixture = sourceFixture();
    fixture.setColumns([columns[0]]);
    fixture.setSnapshot({ version: 1, rows: [] });
    persistWrites(fixture);
    const commit = vi.mocked(fixture.source.write).getMockImplementation()!;
    vi.mocked(fixture.source.write).mockImplementationOnce(
      async (mutation, version) => {
        await commit(mutation, version);
        throw new DatabaseWriteOutcomeUnknown('The response was lost.');
      }
    );
    render(() => (
      <DatabaseTableView
        name="Projects"
        source={fixture.source}
        canEdit
        view={defaultDatabaseView()}
        addColumn={() => null}
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
    const fixture = sourceFixture();
    persistWrites(fixture);
    render(() => (
      <DatabaseTableView
        name="Projects"
        source={fixture.source}
        canEdit
        view={defaultDatabaseView()}
        addColumn={() => null}
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
    await screen.findByRole('menuitem', { name: 'Done' });
    await waitFor(() =>
      expect(fixture.source.write).toHaveBeenCalledWith(
        { kind: 'cell', rowId: 'row', columnId: 'title', value: 'Launch plan' },
        1
      )
    );
    expect(
      within(dialog)
        .getByRole('button', { name: 'Status: To do', hidden: true })
        .getAttribute('aria-expanded')
    ).toBe('true');
  });

  it('cancels the title draft with Escape before closing the record on a second Escape', async () => {
    const { source } = sourceFixture();
    render(() => (
      <DatabaseTableView
        name="Projects"
        source={source}
        canEdit
        view={defaultDatabaseView()}
        addColumn={() => null}
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
    const { source } = sourceFixture();
    render(() => (
      <DatabaseTableView
        name="Projects"
        source={source}
        canEdit={false}
        view={defaultDatabaseView()}
        addColumn={() => null}
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
      const fixture = sourceFixture();
      fixture.setColumns([
        ...columns,
        { ...columns[0], id: 'amount', name: 'Amount', dataType: 'NUMBER' },
      ]);
      fixture.setSnapshot({
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
        <DatabaseTableView
          name="Projects"
          source={fixture.source}
          canEdit
          view={defaultDatabaseView()}
          addColumn={() => null}
        />
      ));
      fireEvent.click(screen.getByRole('button', { name: 'Open Plan launch' }));
      const dialog = await screen.findByRole('dialog', { name: 'Plan launch' });
      if (kind === 'option') {
        await userEvent.click(
          within(dialog).getByRole('button', { name: 'Status: To do' })
        );
        fireEvent.keyDown(
          await screen.findByRole('menuitem', { name: 'Add option' }),
          { key: 'Enter' }
        );
        const input = await screen.findByRole('textbox', {
          name: 'New option',
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
        within(dialog).queryByRole('textbox', { name: 'New option' })
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
    const fixture = sourceFixture();
    fixture.setColumns([columns[0]]);
    let complete!: () => void;
    vi.mocked(fixture.source.write).mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        complete = resolve;
      });
      return { version: 2, insertedRowIds: [] };
    });
    render(() => (
      <DatabaseTableView
        name="Projects"
        source={fixture.source}
        canEdit
        view={defaultDatabaseView()}
        addColumn={() => null}
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
      1
    );
  });

  it.each([true, false])(
    'focuses the first cell after initial loading; empty table=%s',
    async (empty) => {
      const fixture = sourceFixture();
      persistWrites(fixture);
      const [loading, setLoading] = createSignal(true);
      fixture.source.loading = loading;
      if (empty) fixture.setSnapshot({ version: 1, rows: [] });
      let actions!: DatabaseTableActions;
      render(() => (
        <DatabaseTableView
          name="Projects"
          source={fixture.source}
          canEdit
          view={defaultDatabaseView()}
          addColumn={() => null}
          renderToolbar={(ready) => {
            actions = ready;
            return null;
          }}
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

  it('cancels pending initial cell focus when the table is unmounted', async () => {
    const fixture = sourceFixture();
    const [loading, setLoading] = createSignal(true);
    fixture.source.loading = loading;
    let actions!: DatabaseTableActions;
    const { unmount } = render(() => (
      <DatabaseTableView
        name="Projects"
        source={fixture.source}
        canEdit
        view={defaultDatabaseView()}
        addColumn={() => null}
        renderToolbar={(ready) => {
          actions = ready;
          return null;
        }}
      />
    ));
    const pending = actions.focusFirstCell();
    unmount();
    setLoading(false);
    await pending;
    expect(fixture.source.write).not.toHaveBeenCalled();
  });

  it('focuses a new column header and edits its cells in a row created from the blank draft', async () => {
    const fixture = sourceFixture();
    fixture.setColumns([columns[0]]);
    fixture.setSnapshot({ version: 1, rows: [] });
    persistWrites(fixture);
    let actions!: DatabaseTableActions;
    render(() => (
      <DatabaseTableView
        name="Projects"
        source={fixture.source}
        canEdit
        onRenameColumn={vi.fn(async () => {})}
        view={defaultDatabaseView()}
        addColumn={() => null}
        renderToolbar={(value) => {
          actions = value;
          return null;
        }}
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
        2
      )
    );
    expect(fixture.source.snapshot()?.rows).toHaveLength(1);
    await actions.focusFirstCell();
    const first = await screen.findByRole('textbox', { name: 'Edit Name' });
    expect((first as HTMLInputElement).value).toBe('Created from draft');
    await waitFor(() => expect(document.activeElement).toBe(first));
  });

  it('retries a failed duplicate from its row menu once and focuses the new inline name', async () => {
    const fixture = sourceFixture();
    persistWrites(fixture);
    vi.mocked(fixture.source.write).mockRejectedValueOnce(
      new Error('Connection lost')
    );
    render(() => (
      <DatabaseTableView
        name="Projects"
        source={fixture.source}
        canEdit
        view={defaultDatabaseView()}
        addColumn={() => null}
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
      1
    );
  });

  it('confirms a context-menu deletion and retries the same record without leaving a stale failure', async () => {
    const fixture = sourceFixture();
    persistWrites(fixture);
    fixture.setSnapshot({
      version: 1,
      rows: [
        { rowId: 'row', cells: { title: 'Plan launch', status: 'To do' } },
        {
          rowId: 'other',
          cells: { title: 'Keep this record', status: 'Done' },
        },
      ],
    });
    vi.mocked(fixture.source.write).mockRejectedValueOnce(
      new Error('Connection lost')
    );
    render(() => (
      <DatabaseTableView
        name="Projects"
        source={fixture.source}
        canEdit
        view={defaultDatabaseView()}
        addColumn={() => null}
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
      1
    );
    expect(fixture.source.snapshot()?.rows.map((row) => row.rowId)).toEqual([
      'other',
    ]);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it.each(['draft', 'error banner'])(
    'creates only one card when a failed draft is retried through the %s',
    async (surface) => {
      const fixture = sourceFixture();
      persistWrites(fixture);
      const commit = vi.mocked(fixture.source.write).getMockImplementation()!;
      let complete!: () => void;
      const pending = new Promise<void>((resolve) => {
        complete = resolve;
      });
      vi.mocked(fixture.source.write)
        .mockRejectedValueOnce(new Error('Connection lost'))
        .mockImplementationOnce(async (mutation, version) => {
          await pending;
          return await commit(mutation, version);
        });
      render(() => (
        <DatabaseTableView
          name="Projects"
          source={fixture.source}
          canEdit
          view={{
            ...defaultDatabaseView(),
            layout: 'board',
            groupBy: 'status',
          }}
          addColumn={() => <button type="button">Add column</button>}
        />
      ));
      fireEvent.click(
        screen.getByRole('button', { name: 'Add record to Done' })
      );
      fireEvent.input(
        screen.getByRole('textbox', { name: 'New record title' }),
        { target: { value: 'One new card' } }
      );
      fireEvent.click(screen.getByRole('button', { name: 'Add record' }));
      await screen.findByRole('alert');
      await waitFor(() =>
        expect(
          (
            screen.getByRole('button', {
              name: 'Add record',
            }) as HTMLButtonElement
          ).disabled
        ).toBe(false)
      );
      fireEvent.click(
        screen.getByRole('button', {
          name: surface === 'draft' ? 'Add record' : 'Retry',
        })
      );
      await waitFor(() =>
        expect(fixture.source.write).toHaveBeenCalledTimes(2)
      );
      const submitted = screen.getByRole('status', {
        name: 'Saving new record',
      });
      expect(submitted.textContent).toContain('One new card');
      expect(
        screen.queryByRole('textbox', { name: 'New record title' })
      ).toBeNull();
      fireEvent.keyDown(submitted, { key: 'Escape' });
      expect(screen.getByRole('status', { name: 'Saving new record' })).toBe(
        submitted
      );
      expect(fixture.source.write).toHaveBeenCalledTimes(2);
      complete();
      await screen.findByRole('button', { name: 'Open One new card' });
      await waitFor(() =>
        expect(
          screen.queryByRole('textbox', { name: 'New record title' })
        ).toBeNull()
      );
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
        fireEvent.input(
          screen.getByRole('textbox', { name: 'New record title' }),
          { target: { value: 'A second intentional card' } }
        );
        fireEvent.click(screen.getByRole('button', { name: 'Add record' }));
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

  it('keeps an active draft editor through a filtered create acknowledgment and saves its next cell before reconciling the filter', async () => {
    const fixture = sourceFixture();
    fixture.setColumns([
      columns[0],
      { ...columns[0], id: 'notes', name: 'Notes' },
    ]);
    persistWrites(fixture);
    const commit = vi.mocked(fixture.source.write).getMockImplementation()!;
    let complete!: () => void;
    vi.mocked(fixture.source.write).mockImplementation(
      async (mutation, version) => {
        if (mutation.kind === 'create')
          await new Promise<void>((resolve) => {
            complete = resolve;
          });
        return commit(mutation, version);
      }
    );
    render(() => (
      <DatabaseTableView
        name="Projects"
        source={fixture.source}
        canEdit
        view={{ ...defaultDatabaseView(), search: 'launch' }}
        addColumn={() => null}
      />
    ));
    fireEvent.click(
      screen.getByRole('button', { name: 'Name: Unnamed. Click to edit' })
    );
    fireEvent.input(await screen.findByRole('textbox', { name: 'Edit Name' }), {
      target: { value: 'Outside view' },
    });
    await userEvent.tab();
    const notes = await screen.findByRole('textbox', { name: 'Edit Notes' });
    fireEvent.input(notes, { target: { value: 'Keep these notes' } });
    await waitFor(() => expect(fixture.source.write).toHaveBeenCalledTimes(1));
    complete();
    await waitFor(() =>
      expect(fixture.source.snapshot()?.rows).toHaveLength(2)
    );
    expect(screen.getByRole('textbox', { name: 'Edit Notes' })).toBe(notes);
    expect(document.activeElement).toBe(notes);
    expect((notes as HTMLInputElement).value).toBe('Keep these notes');
    await userEvent.tab();
    await waitFor(() =>
      expect(fixture.source.write).toHaveBeenNthCalledWith(
        2,
        {
          kind: 'cell',
          rowId: 'created',
          columnId: 'notes',
          value: 'Keep these notes',
        },
        2
      )
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /Name: Outside view/ })
      ).toBeNull()
    );
    expect(
      fixture.source.snapshot()?.rows.find((row) => row.rowId === 'created')
        ?.cells.notes
    ).toBe('Keep these notes');
    expect(fixture.source.snapshot()?.rows).toHaveLength(2);
  });

  it('reveals a newly created filtered record only on request without changing the view', async () => {
    const fixture = sourceFixture();
    persistWrites(fixture);
    const changeView = vi.fn();
    render(() => (
      <DatabaseTableView
        name="Projects"
        source={fixture.source}
        canEdit
        view={{
          ...defaultDatabaseView(),
          search: 'launch',
          filters: [
            {
              id: 'filter',
              columnId: 'status',
              operator: 'equals',
              value: 'To do',
            },
          ],
        }}
        onViewChange={changeView}
        addColumn={() => <button type="button">Add column</button>}
      />
    ));
    fireEvent.click(
      screen.getByRole('button', { name: 'Name: Unnamed. Click to edit' })
    );
    const draft = await screen.findByRole('textbox', { name: 'Edit Name' });
    fireEvent.input(draft, { target: { value: 'Outside view' } });
    fireEvent.keyDown(draft, { key: 'Enter' });
    await screen.findByText('Record created outside this view');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open record' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(
        'This record doesn’t match your search and filters. You can keep editing it here.'
      )
    ).toBeTruthy();
    expect(
      (
        within(dialog).getByRole('button', {
          name: 'Next record',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(
      (
        within(dialog).getByRole('button', {
          name: 'Previous record',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(
      within(dialog).getByRole('textbox', { name: 'Edit Name' })
    ).toBeTruthy();
    expect(changeView).not.toHaveBeenCalled();
    expect(fixture.source.write).toHaveBeenCalledTimes(1);
  });

  it('reveals a card created outside search through its saved notice without creating it again', async () => {
    const fixture = sourceFixture();
    persistWrites(fixture);
    const changeView = vi.fn();
    render(() => (
      <DatabaseTableView
        name="Projects"
        source={fixture.source}
        canEdit
        view={{
          ...defaultDatabaseView(),
          layout: 'board',
          groupBy: 'status',
          search: 'launch',
        }}
        onViewChange={changeView}
        addColumn={() => <button type="button">Add column</button>}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Add record to Done' }));
    fireEvent.input(screen.getByRole('textbox', { name: 'New record title' }), {
      target: { value: 'Write announcement' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add record' }));
    await screen.findByText('Record created outside this view');
    expect(
      screen.queryByRole('button', { name: 'Open Write announcement' })
    ).toBeNull();
    await waitFor(() =>
      expect(
        screen.queryByRole('textbox', { name: 'New record title' })
      ).toBeNull()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open record' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('heading', { name: 'Write announcement' })
    ).toBeTruthy();
    expect(
      within(dialog).getByText(
        'This record doesn’t match your search. You can keep editing it here.'
      )
    ).toBeTruthy();
    expect(changeView).not.toHaveBeenCalled();
    expect(fixture.source.write).toHaveBeenCalledTimes(1);
  });

  it('explains a card moved outside filters and lets the user reopen it without clearing them', async () => {
    const fixture = sourceFixture();
    persistWrites(fixture);
    const changeView = vi.fn();
    render(() => (
      <DatabaseTableView
        name="Projects"
        source={fixture.source}
        canEdit
        view={{
          ...defaultDatabaseView(),
          layout: 'board',
          groupBy: 'status',
          filters: [
            {
              id: 'filter',
              columnId: 'status',
              operator: 'equals',
              value: 'To do',
            },
          ],
        }}
        onViewChange={changeView}
        addColumn={() => <button type="button">Add column</button>}
      />
    ));
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Move Plan launch' }),
      { key: 'Enter' }
    );
    fireEvent.keyDown(await screen.findByRole('menuitem', { name: 'Done' }), {
      key: 'Enter',
    });
    await screen.findByText('Record saved outside this view');
    expect(
      screen.queryByRole('button', { name: 'Open Plan launch' })
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open record' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('heading', { name: 'Plan launch' })
    ).toBeTruthy();
    expect(
      within(dialog).getByText(
        'This record doesn’t match your filters. You can keep editing it here.'
      )
    ).toBeTruthy();
    expect(changeView).not.toHaveBeenCalled();
    expect(fixture.source.write).toHaveBeenCalledExactlyOnceWith(
      { kind: 'cell', rowId: 'row', columnId: 'status', value: 'Done' },
      1
    );
  });

  it('keeps editing a record that stops matching search and removes the explanation when it matches again', async () => {
    const fixture = sourceFixture();
    persistWrites(fixture);
    render(() => (
      <DatabaseTableView
        name="Projects"
        source={fixture.source}
        canEdit
        view={{ ...defaultDatabaseView(), search: 'launch' }}
        addColumn={() => <button type="button">Add column</button>}
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
      'This record doesn’t match your search. You can keep editing it here.'
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

  it('retains an acknowledged new record for explicit reveal after refresh failure without offering a duplicate create retry', async () => {
    const { source } = sourceFixture();
    vi.mocked(source.write).mockResolvedValue({
      version: 2,
      insertedRowIds: ['created'],
    });
    vi.mocked(source.refresh).mockRejectedValue(new Error('Connection lost'));
    render(() => (
      <DatabaseTableView
        name="Projects"
        source={source}
        canEdit
        view={{ ...defaultDatabaseView(), search: 'launch' }}
        addColumn={() => <button type="button">Add column</button>}
      />
    ));
    fireEvent.click(
      screen.getByRole('button', { name: 'Name: Unnamed. Click to edit' })
    );
    const draft = await screen.findByRole('textbox', { name: 'Edit Name' });
    fireEvent.input(draft, { target: { value: 'Outside view' } });
    fireEvent.keyDown(draft, { key: 'Enter' });
    await screen.findByText('Record created outside this view');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open record' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('textbox', { name: 'Edit Name' })
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(source.write).toHaveBeenCalledTimes(1);
  });

  it('does not announce a failed move as saved and reveals it only after a successful Retry', async () => {
    const fixture = sourceFixture();
    persistWrites(fixture);
    vi.mocked(fixture.source.write).mockRejectedValueOnce(
      new Error('Connection lost')
    );
    const changeView = vi.fn();
    render(() => (
      <DatabaseTableView
        name="Projects"
        source={fixture.source}
        canEdit
        view={{
          ...defaultDatabaseView(),
          layout: 'board',
          groupBy: 'status',
          filters: [
            {
              id: 'filter',
              columnId: 'status',
              operator: 'equals',
              value: 'To do',
            },
          ],
        }}
        onViewChange={changeView}
        addColumn={() => <button type="button">Add column</button>}
      />
    ));
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Move Plan launch' }),
      { key: 'Enter' }
    );
    fireEvent.keyDown(await screen.findByRole('menuitem', { name: 'Done' }), {
      key: 'Enter',
    });
    await screen.findByRole('alert');
    expect(screen.queryByText('Record saved outside this view')).toBeNull();
    expect(
      await screen.findByRole('button', { name: 'Open Plan launch' })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Record saved outside this view');
    expect(fixture.source.write).toHaveBeenCalledTimes(2);
    expect(changeView).not.toHaveBeenCalled();
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
      const fixture = sourceFixture();
      fixture.setColumns(schema);
      persistWrites(fixture);
      render(() => (
        <DatabaseTableView
          name="Projects"
          source={fixture.source}
          canEdit
          view={defaultDatabaseView()}
          addColumn={() => null}
          renderToolbar={(actions) => (
            <button type="button" onClick={() => void actions.createRecord()}>
              New record
            </button>
          )}
        />
      ));
      fireEvent.click(screen.getByRole('button', { name: 'New record' }));
      expect(fixture.source.write).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).toBeNull();
      if (editsTitle) {
        const name = await screen.findByRole('textbox', { name: 'Edit Name' });
        await waitFor(() => expect(document.activeElement).toBe(name));
        expect((name as HTMLInputElement).value).toBe('');
        expect(screen.getByRole('grid').contains(name)).toBe(true);
        fireEvent.input(name, { target: { value: 'New project' } });
        fireEvent.keyDown(name, { key: 'Enter' });
      } else {
        expect(screen.queryByRole('textbox', { name: /^Edit / })).toBeNull();
        fireEvent.keyDown(
          await screen.findByRole('menuitem', { name: 'Done' }),
          { key: 'Enter' }
        );
      }
      await waitFor(() =>
        expect(fixture.source.write).toHaveBeenCalledExactlyOnceWith(
          {
            kind: 'create',
            values: editsTitle ? { title: 'New project' } : { status: 'Done' },
          },
          1
        )
      );
    }
  );

  it.each(['table', 'record panel'])(
    'keeps an active %s editor, draft and focus during row and cloned schema refreshes',
    (surface) => {
      const { source, setSnapshot, setColumns } = sourceFixture();
      render(() => (
        <DatabaseTableView
          name="Projects"
          source={source}
          canEdit
          view={defaultDatabaseView()}
          addColumn={() => <button type="button">Add property</button>}
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
      setSnapshot({
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

  it('keeps the title property for card titles and new writes when it is hidden from metadata', async () => {
    const { source } = sourceFixture();
    render(() => (
      <DatabaseTableView
        name="Projects"
        source={source}
        canEdit
        view={{
          ...defaultDatabaseView(),
          layout: 'board',
          groupBy: 'status',
          hiddenColumns: ['title'],
        }}
        addColumn={() => <button type="button">Add property</button>}
      />
    ));
    expect(
      screen.getByRole('button', { name: 'Open Plan launch' })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add record to Done' }));
    fireEvent.input(screen.getByRole('textbox', { name: 'New record title' }), {
      target: { value: 'New launch' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add record' }));
    await waitFor(() =>
      expect(source.write).toHaveBeenCalledWith(
        { kind: 'create', values: { status: 'Done', title: 'New launch' } },
        1
      )
    );
  });

  it.each([
    {
      dataType: 'SELECT_STRING',
      name: 'Status',
      options: ['Done'],
      lane: 'Done',
      value: 'Done',
    },
    {
      dataType: 'SELECT_NUMBER',
      name: 'Priority',
      options: ['2'],
      lane: '2',
      value: '2',
    },
    {
      dataType: 'BOOLEAN',
      name: 'Complete',
      options: [],
      lane: 'Checked',
      value: 1,
    },
  ])(
    'creates a $dataType-only card without writing a title into its grouping field',
    async ({ dataType, name, options, lane, value }) => {
      const { source, setColumns, setSnapshot } = sourceFixture();
      setColumns([
        {
          id: 'group',
          name,
          dataType,
          options,
          isMultiSelect: false,
          writable: true,
        },
      ]);
      setSnapshot({ version: 1, rows: [] });
      render(() => (
        <DatabaseTableView
          name="Projects"
          source={source}
          canEdit
          view={{ ...defaultDatabaseView(), layout: 'board', groupBy: 'group' }}
          addColumn={() => <button type="button">Add property</button>}
        />
      ));
      fireEvent.click(
        screen.getByRole('button', { name: `Add record to ${lane}` })
      );
      expect(
        screen.queryByRole('textbox', { name: 'New record title' })
      ).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Add record' }));
      await waitFor(() =>
        expect(source.write).toHaveBeenCalledWith(
          { kind: 'create', values: { group: value } },
          1
        )
      );
    }
  );

  it('creates a card without writing a read-only string title', async () => {
    const { source, setColumns } = sourceFixture();
    setColumns([{ ...columns[0], writable: false }, columns[1]]);
    render(() => (
      <DatabaseTableView
        name="Projects"
        source={source}
        canEdit
        view={{ ...defaultDatabaseView(), layout: 'board', groupBy: 'status' }}
        addColumn={() => <button type="button">Add property</button>}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Add record to Done' }));
    expect(
      screen.queryByRole('textbox', { name: 'New record title' })
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add record' }));
    await waitFor(() =>
      expect(source.write).toHaveBeenCalledWith(
        { kind: 'create', values: { status: 'Done' } },
        1
      )
    );
  });

  it('shows save failures and a working retry inside the record panel', async () => {
    const { source } = sourceFixture();
    vi.mocked(source.write).mockRejectedValueOnce(new Error('Offline'));
    render(() => (
      <DatabaseTableView
        name="Projects"
        source={source}
        canEdit
        view={defaultDatabaseView()}
        addColumn={() => <button type="button">Add property</button>}
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

  it('uses an explicit first-property action when the table has no schema', () => {
    const { source, setSnapshot } = sourceFixture();
    source.columns = () => [];
    setSnapshot({ version: 1, rows: [] });
    render(() => (
      <DatabaseTableView
        name="Projects"
        source={source}
        canEdit
        view={defaultDatabaseView()}
        addColumn={(label) => (
          <button type="button">{label ?? 'Add property'}</button>
        )}
      />
    ));
    expect(
      screen.getByRole('button', { name: 'Add first column' })
    ).toBeTruthy();
  });

  it('requires a new delete confirmation after navigating to another record', async () => {
    const { source, setSnapshot } = sourceFixture();
    setSnapshot({
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
      <DatabaseTableView
        name="Projects"
        source={source}
        canEdit
        view={defaultDatabaseView()}
        addColumn={() => <button type="button">Add property</button>}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Open Plan launch' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete record' }));
    const previousConfirmation = screen.getByRole('button', {
      name: 'Delete',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next record' }));
    expect(screen.queryByText('Delete this record?')).toBeNull();
    fireEvent.click(previousConfirmation);
    expect(source.write).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Previous record' }));
    expect(screen.queryByText('Delete this record?')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next record' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete record' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(source.write).toHaveBeenCalledWith(
        { kind: 'delete', rowId: 'next' },
        1
      )
    );
    expect(source.write).toHaveBeenCalledTimes(1);
  });

  it('makes column sorting explicit and supplies record creation to the toolbar', async () => {
    const { source } = sourceFixture();
    const changeView = vi.fn();
    render(() => (
      <DatabaseTableView
        name="Projects"
        source={source}
        canEdit
        view={defaultDatabaseView()}
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
      ...defaultDatabaseView(),
      sorts: [{ columnId: 'title', direction: 'desc' }],
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
        1
      )
    );
  });

  it('persists menu moves at the neighboring visible edge in both directions', async () => {
    const { source, setColumns } = sourceFixture();
    setColumns([...columns, { ...columns[0], id: 'notes', name: 'Notes' }]);
    const [view, setView] = createSignal({
      ...defaultDatabaseView(),
      hiddenColumns: ['status'],
    });
    const reorder = vi.fn(async (_order: string[]) => {});
    render(() => (
      <DatabaseTableView
        name="Projects"
        source={source}
        canEdit
        view={view()}
        onViewChange={setView}
        onReorderColumns={reorder}
        addColumn={() => null}
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
      expect(view().columnOrder).toEqual(['notes', 'status', 'title'])
    );
    expect(reorder).toHaveBeenNthCalledWith(1, ['notes', 'status', 'title']);
    await moveName('left');
    await waitFor(() =>
      expect(view().columnOrder).toEqual(['title', 'status', 'notes'])
    );
    expect(reorder).toHaveBeenNthCalledWith(2, ['title', 'status', 'notes']);
    expect(source.write).not.toHaveBeenCalled();
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
      'status',
      'title',
      'owner',
    ]);

    fixture.requests[0].resolve();
    await waitFor(() => expect(fixture.requests).toHaveLength(2));
    expect(fixture.reorder).toHaveBeenNthCalledWith(2, [
      'notes',
      'status',
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
    fixture.setView({ ...fixture.view(), search: 'Plan' });
    fixture.requests[1].reject(new Error('This table changed. Try again.'));
    await screen.findByRole('alert');
    expect(fixture.view().columnOrder).toEqual([
      'notes',
      'status',
      'title',
      'owner',
    ]);
    expect(fixture.view().search).toBe('Plan');
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
    fixture.requests[0].reject(new Error('First save failed'));
    await waitFor(() => expect(fixture.requests).toHaveLength(2));
    expect(fixture.headers()).toEqual([
      'Notes column menu',
      'Owner column menu',
      'Name column menu',
    ]);
    fixture.requests[1].reject(new Error('Final save failed'));
    await screen.findByText('Final save failed');
    expect(fixture.view().columnOrder).toEqual([
      'title',
      'status',
      'notes',
      'owner',
    ]);
  });

  it('does not overwrite a newly selected layout when a pending reorder fails', async () => {
    const fixture = columnOrderFixture();
    await fixture.moveName('right');
    const selected: DatabaseViewConfig = {
      ...defaultDatabaseView(),
      columnOrder: ['owner', 'title', 'notes', 'status'],
    };
    fixture.setView(selected);
    fixture.changeView.mockClear();
    fixture.requests[0].reject(new Error('Save failed'));
    await screen.findByText('Save failed');
    expect(fixture.changeView).not.toHaveBeenCalled();
    expect(fixture.view()).toEqual(selected);
  });

  it('lets viewers move and hide columns while keeping every record accessible and restoring its layout', async () => {
    const { source, setColumns, setSnapshot } = sourceFixture();
    setColumns([...columns, { ...columns[0], id: 'notes', name: 'Notes' }]);
    setSnapshot({
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
    const [view, setView] = createSignal({
      ...defaultDatabaseView(),
      hiddenColumns: ['status'],
    });
    render(() => (
      <DatabaseTableView
        name="Projects"
        source={source}
        canEdit={false}
        view={view()}
        onViewChange={setView}
        addColumn={() => null}
        renderToolbar={() => (
          <DatabaseToolbar
            columns={source.columns()}
            value={view()}
            onChange={setView}
            savedViews={[]}
            onSelectView={vi.fn()}
            onSaveView={vi.fn(async () => {})}
            onRenameView={vi.fn(async () => {})}
            onDeleteView={vi.fn(async () => {})}
          />
        )}
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
      expect(headers()).toEqual(['Notes column menu', 'Name column menu'])
    );
    expect(view().columnOrder).toEqual(['notes', 'status', 'title']);

    openMenu('Name');
    fireEvent.keyDown(
      await screen.findByRole('menuitem', { name: 'Hide column' }),
      { key: 'Enter' }
    );
    await waitFor(() => expect(headers()).toEqual(['Notes column menu']));
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

    fireEvent.click(screen.getByRole('button', { name: 'View settings' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Name' }));
    await waitFor(() =>
      expect(headers()).toEqual(['Notes column menu', 'Name column menu'])
    );
    expect(view().hiddenColumns).toEqual(['status']);
    expect(source.write).not.toHaveBeenCalled();
  });
  it('lets an empty Name-only table create its first record directly below the headers', async () => {
    const fixture = sourceFixture();
    fixture.setColumns([columns[0]]);
    fixture.setSnapshot({ version: 1, rows: [] });
    persistWrites(fixture);
    render(() => (
      <DatabaseTableView
        name="Playground"
        source={fixture.source}
        canEdit
        view={defaultDatabaseView()}
        addColumn={() => <button type="button">Add column</button>}
        renderToolbar={(actions) => (
          <button type="button" onClick={() => void actions.createRecord()}>
            New record
          </button>
        )}
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
    expect(
      screen.getByRole('button', { name: /Name: First record/ })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Name: Unnamed. Click to edit' })
    ).toBeTruthy();
    expect(fixture.source.write).toHaveBeenCalledExactlyOnceWith(
      { kind: 'create', values: { title: 'First record' } },
      1
    );
  });
});
