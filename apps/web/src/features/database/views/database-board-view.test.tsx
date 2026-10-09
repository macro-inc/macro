import type { CardPosition } from '@service-storage/generated/schemas/cardPosition';
import type { DatabaseView } from '@service-storage/generated/schemas/databaseView';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { errAsync, ok, okAsync, ResultAsync } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Board,
  Catalog,
  Outcome,
} from '../../../lib/core/database-sql/generated/types';
import type { CardMoved } from '../core/view-state';
import type { DatabaseOpFailure } from '../core/write-failure';
import type { BoardPositionsState } from '../primitives/board-layout';
import { DatabaseBoardView } from './database-board-view';

const engine = vi.hoisted(() => ({
  board:
    vi.fn<
      (
        catalog: Catalog,
        view: DatabaseView,
        outcome: Outcome,
        positions: CardPosition[]
      ) => Board
    >(),
  keyBetween: vi.fn<(before: string | null, after: string | null) => string>(),
}));
const toastFailure = vi.hoisted(() => vi.fn());
const loadEngine = vi.hoisted(() =>
  vi.fn(async () => ({
    board: engine.board,
    keyBetween: engine.keyBetween,
  }))
);

vi.mock('../../../lib/core/database-sql/wasm-module', () => ({
  loadDatabaseSqlWasm: loadEngine,
}));
vi.mock('../../../lib/core/component/Toast/Toast', () => ({
  toast: { failure: toastFailure },
}));

// Lanes sit side by side, Done at 0 and To do at 300; each lane's cards stack
// from y = 60, 100 apart and 80 tall.
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      if (this.classList.contains('overflow-auto'))
        return new DOMRect(0, 0, 880, 500);
      const lane = this.closest('[data-kanban-lane]');
      const x = lane?.getAttribute('aria-label') === 'To do lane' ? 300 : 0;
      const cardIndex = lane
        ? Array.from(lane.querySelectorAll('[data-kanban-card]')).indexOf(this)
        : 0;
      return this.hasAttribute('data-row-id')
        ? new DOMRect(x + 8, 60 + Math.max(0, cardIndex) * 100, 264, 80)
        : new DOMRect(x, 0, 280, 500);
    }
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  engine.board.mockReset();
  engine.keyBetween.mockReset();
  toastFailure.mockReset();
});

// Reads the lane by its label: a closing dialog still hides the board from role queries.
const cardsIn = (lane: string) =>
  Array.from(
    document.querySelectorAll(
      `[data-kanban-lane][aria-label="${lane} lane"] [data-row-id]`
    ),
    (card) => card.getAttribute('data-row-id')
  );

describe('database board view', () => {
  it('sends a drop as a move between its neighbours and shows the card there at once', async () => {
    const view: DatabaseView = {
      id: 'view',
      databaseId: 'database',
      tableId: 'table',
      name: 'Board',
      position: 'a0',
      query: { filter: null, sort: [] },
      layout: {
        kind: 'board',
        title: 'name',
        groupBy: 'stage',
        lanes: [],
        cardFields: [],
        hideEmptyLanes: false,
      },
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
    };
    const outcome: Outcome = {
      columns: [],
      rows: [],
      rowIds: ['first', 'moving', 'last'],
      readTables: ['table'],
      truncated: false,
      insertedRowIds: [],
      changesApplied: 0,
    };
    engine.board.mockReturnValue({
      lanes: [
        {
          key: { kind: 'option', id: 'done' },
          hidden: false,
          cards: ['first', 'last'],
        },
        {
          key: { kind: 'option', id: 'todo' },
          hidden: false,
          cards: ['moving'],
        },
      ],
    });
    engine.keyBetween.mockReturnValue('a0V');
    const [positions, setPositions] = createSignal<CardPosition[]>([
      { row: 'first', lane: { kind: 'option', id: 'done' }, position: 'a0' },
      { row: 'last', lane: { kind: 'option', id: 'done' }, position: 'a1' },
      { row: 'moving', lane: { kind: 'option', id: 'todo' }, position: 'a0' },
    ]);
    let answer: (moved: CardMoved) => void = () => {};
    const move = vi.fn(
      () =>
        new ResultAsync<CardMoved, DatabaseOpFailure>(
          new Promise((resolve) => {
            answer = (moved) => resolve(ok(moved));
          })
        )
    );
    render(() => (
      <DatabaseBoardView
        view={view}
        source={{
          columns: () => [],
          snapshot: () => undefined,
          read: () => ({ outcome, catalog: { tables: [] }, view }),
          loading: () => false,
          refreshing: () => false,
          error: () => undefined,
          refresh: () => okAsync(undefined),
          write: () => okAsync({ insertedRowIds: [], version: undefined }),
          addOption: () => okAsync(undefined),
          retain: () => {},
        }}
        rows={[
          { rowId: 'first', cells: { name: 'First card', stage: 'Done' } },
          { rowId: 'moving', cells: { name: 'Moving card', stage: 'To do' } },
          { rowId: 'last', cells: { name: 'Last card', stage: 'Done' } },
        ]}
        columns={[
          {
            id: 'name',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          {
            id: 'stage',
            name: 'Stage',
            dataType: 'SELECT_STRING',
            isMultiSelect: false,
            options: [
              { id: 'done', label: 'Done', color: null },
              { id: 'todo', label: 'To do', color: null },
            ],
            writable: true,
          },
        ]}
        positions={{
          state: () => ({ kind: 'ready', positions: positions() }),
          setPositions,
          move,
        }}
        canEdit
        onViewChange={vi.fn()}
        rowPending={() => false}
        createPending={() => false}
        createComplete={() => false}
        onOpen={vi.fn()}
        onCreate={vi.fn(async () => true)}
      />
    ));
    const card = await screen.findByRole('button', {
      name: 'Open Moving card',
    });
    expect(engine.board).toHaveBeenLastCalledWith(
      { tables: [] },
      view,
      outcome,
      [
        { row: 'first', lane: { kind: 'option', id: 'done' }, position: 'a0' },
        { row: 'last', lane: { kind: 'option', id: 'done' }, position: 'a1' },
        { row: 'moving', lane: { kind: 'option', id: 'todo' }, position: 'a0' },
      ]
    );
    fireEvent.mouseDown(card, { button: 0, clientX: 560, clientY: 80 });
    fireEvent.mouseMove(document, { clientX: 30, clientY: 150 });
    fireEvent.mouseUp(document, { button: 0, clientX: 30, clientY: 150 });
    expect(move).toHaveBeenCalledWith({
      row: 'moving',
      lane: { kind: 'option', id: 'done' },
      before: 'first',
      after: 'last',
    });
    expect(engine.keyBetween).toHaveBeenCalledWith('a0', 'a1');
    expect(positions()).toEqual([
      { row: 'first', lane: { kind: 'option', id: 'done' }, position: 'a0' },
      { row: 'last', lane: { kind: 'option', id: 'done' }, position: 'a1' },
      { row: 'moving', lane: { kind: 'option', id: 'done' }, position: 'a0V' },
    ]);
    expect(cardsIn('Done')).toEqual(['first', 'moving', 'last']);
    expect(cardsIn('To do')).toEqual([]);
    answer({
      positions: [
        {
          row: 'moving',
          lane: { kind: 'option', id: 'done' },
          position: 'a0G',
        },
      ],
      tableVersion: 8,
    });
    await waitFor(() =>
      expect(positions()).toEqual([
        { row: 'first', lane: { kind: 'option', id: 'done' }, position: 'a0' },
        { row: 'last', lane: { kind: 'option', id: 'done' }, position: 'a1' },
        {
          row: 'moving',
          lane: { kind: 'option', id: 'done' },
          position: 'a0G',
        },
      ])
    );
    expect(cardsIn('Done')).toEqual(['first', 'moving', 'last']);
  });

  it('keeps a moved card where it was dropped until a read reaches the version its move left', async () => {
    const view: DatabaseView = {
      id: 'view',
      databaseId: 'database',
      tableId: 'table',
      name: 'Board',
      position: 'a0',
      query: { filter: null, sort: [] },
      layout: {
        kind: 'board',
        title: 'name',
        groupBy: 'stage',
        lanes: [],
        cardFields: [],
        hideEmptyLanes: false,
      },
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
    };
    const before: Outcome = {
      columns: [],
      rows: [],
      rowIds: ['first', 'moving'],
      readTables: ['table'],
      truncated: false,
      insertedRowIds: [],
      changesApplied: 0,
    };
    const stale: Outcome = {
      columns: [],
      rows: [],
      rowIds: ['moving', 'first'],
      readTables: ['table'],
      truncated: false,
      insertedRowIds: [],
      changesApplied: 0,
    };
    const fresh: Outcome = {
      columns: [],
      rows: [],
      rowIds: ['first', 'moving'],
      readTables: ['table'],
      truncated: false,
      insertedRowIds: [],
      changesApplied: 0,
    };
    engine.board.mockImplementation((_catalog, _view, outcome) =>
      outcome === fresh
        ? {
            lanes: [
              {
                key: { kind: 'option', id: 'done' },
                hidden: false,
                cards: ['moving', 'first'],
              },
              { key: { kind: 'option', id: 'todo' }, hidden: false, cards: [] },
            ],
          }
        : {
            lanes: [
              {
                key: { kind: 'option', id: 'done' },
                hidden: false,
                cards: ['first'],
              },
              {
                key: { kind: 'option', id: 'todo' },
                hidden: false,
                cards: ['moving'],
              },
            ],
          }
    );
    engine.keyBetween.mockReturnValue('a1');
    const [read, setRead] = createSignal<{ outcome: Outcome; version: number }>(
      { outcome: before, version: 7 }
    );
    const [positions, setPositions] = createSignal<CardPosition[]>([
      { row: 'first', lane: { kind: 'option', id: 'done' }, position: 'a0' },
    ]);
    const move = vi.fn(() =>
      okAsync<CardMoved, DatabaseOpFailure>({
        positions: [
          {
            row: 'moving',
            lane: { kind: 'option', id: 'done' },
            position: 'a1',
          },
        ],
        tableVersion: 8,
      })
    );
    render(() => (
      <DatabaseBoardView
        view={view}
        source={{
          columns: () => [],
          snapshot: () => ({ rows: [], retained: [], version: read().version }),
          read: () => ({
            outcome: read().outcome,
            catalog: { tables: [] },
            view,
          }),
          loading: () => false,
          refreshing: () => false,
          error: () => undefined,
          refresh: () => okAsync(undefined),
          write: () => okAsync({ insertedRowIds: [], version: undefined }),
          addOption: () => okAsync(undefined),
          retain: () => {},
        }}
        rows={[
          { rowId: 'first', cells: { name: 'First card', stage: 'Done' } },
          { rowId: 'moving', cells: { name: 'Moving card', stage: 'To do' } },
        ]}
        columns={[
          {
            id: 'name',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          {
            id: 'stage',
            name: 'Stage',
            dataType: 'SELECT_STRING',
            isMultiSelect: false,
            options: [
              { id: 'done', label: 'Done', color: null },
              { id: 'todo', label: 'To do', color: null },
            ],
            writable: true,
          },
        ]}
        positions={{
          state: () => ({ kind: 'ready', positions: positions() }),
          setPositions,
          move,
        }}
        canEdit
        onViewChange={vi.fn()}
        rowPending={() => false}
        createPending={() => false}
        createComplete={() => false}
        onOpen={vi.fn()}
        onCreate={vi.fn(async () => true)}
      />
    ));
    const trigger = await screen.findByRole('button', {
      name: 'Move Moving card',
    });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.keyDown(await screen.findByRole('menuitem', { name: 'Done' }), {
      key: 'Enter',
    });
    await waitFor(() =>
      expect(positions()).toEqual([
        { row: 'first', lane: { kind: 'option', id: 'done' }, position: 'a0' },
        { row: 'moving', lane: { kind: 'option', id: 'done' }, position: 'a1' },
      ])
    );
    expect(cardsIn('Done')).toEqual(['first', 'moving']);
    // A read begun before the move lands after the server took it.
    setRead({ outcome: stale, version: 7 });
    expect(cardsIn('Done')).toEqual(['first', 'moving']);
    expect(cardsIn('To do')).toEqual([]);
    setRead({ outcome: fresh, version: 8 });
    expect(cardsIn('Done')).toEqual(['moving', 'first']);
    expect(cardsIn('To do')).toEqual([]);
  });

  it('puts a card back where it was when the move is refused', async () => {
    const view: DatabaseView = {
      id: 'view',
      databaseId: 'database',
      tableId: 'table',
      name: 'Board',
      position: 'a0',
      query: { filter: null, sort: [] },
      layout: {
        kind: 'board',
        title: 'name',
        groupBy: 'stage',
        lanes: [],
        cardFields: [],
        hideEmptyLanes: false,
      },
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
    };
    const outcome: Outcome = {
      columns: [],
      rows: [],
      rowIds: ['first', 'moving'],
      readTables: ['table'],
      truncated: false,
      insertedRowIds: [],
      changesApplied: 0,
    };
    engine.board.mockReturnValue({
      lanes: [
        {
          key: { kind: 'option', id: 'done' },
          hidden: false,
          cards: ['first'],
        },
        {
          key: { kind: 'option', id: 'todo' },
          hidden: false,
          cards: ['moving'],
        },
      ],
    });
    engine.keyBetween.mockReturnValue('a1');
    const [positions, setPositions] = createSignal<CardPosition[]>([
      { row: 'first', lane: { kind: 'option', id: 'done' }, position: 'a0' },
    ]);
    const move = vi.fn(() =>
      errAsync<CardMoved, DatabaseOpFailure>({
        kind: 'unexpected-result',
      })
    );
    render(() => (
      <DatabaseBoardView
        view={view}
        source={{
          columns: () => [],
          snapshot: () => undefined,
          read: () => ({ outcome, catalog: { tables: [] }, view }),
          loading: () => false,
          refreshing: () => false,
          error: () => undefined,
          refresh: () => okAsync(undefined),
          write: () => okAsync({ insertedRowIds: [], version: undefined }),
          addOption: () => okAsync(undefined),
          retain: () => {},
        }}
        rows={[
          { rowId: 'first', cells: { name: 'First card', stage: 'Done' } },
          { rowId: 'moving', cells: { name: 'Moving card', stage: 'To do' } },
        ]}
        columns={[
          {
            id: 'name',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          {
            id: 'stage',
            name: 'Stage',
            dataType: 'SELECT_STRING',
            isMultiSelect: false,
            options: [
              { id: 'done', label: 'Done', color: null },
              { id: 'todo', label: 'To do', color: null },
            ],
            writable: true,
          },
        ]}
        positions={{
          state: () => ({ kind: 'ready', positions: positions() }),
          setPositions,
          move,
        }}
        canEdit
        onViewChange={vi.fn()}
        rowPending={() => false}
        createPending={() => false}
        createComplete={() => false}
        onOpen={vi.fn()}
        onCreate={vi.fn(async () => true)}
      />
    ));
    const trigger = await screen.findByRole('button', {
      name: 'Move Moving card',
    });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.keyDown(await screen.findByRole('menuitem', { name: 'Done' }), {
      key: 'Enter',
    });
    await waitFor(() =>
      expect(move).toHaveBeenCalledWith({
        row: 'moving',
        lane: { kind: 'option', id: 'done' },
        before: 'first',
        after: null,
      })
    );
    await waitFor(() =>
      expect(toastFailure).toHaveBeenCalledWith(
        'The database answered the change with something else.'
      )
    );
    expect(cardsIn('To do')).toEqual(['moving']);
    expect(cardsIn('Done')).toEqual(['first']);
  });

  it('asks to remove the sort before moving a card, then clears the sort and moves it', async () => {
    const view: DatabaseView = {
      id: 'view',
      databaseId: 'database',
      tableId: 'table',
      name: 'Board',
      position: 'a0',
      query: {
        filter: null,
        sort: [{ column: 'name', direction: 'ascending' }],
      },
      layout: {
        kind: 'board',
        title: 'name',
        groupBy: 'stage',
        lanes: [],
        cardFields: [],
        hideEmptyLanes: false,
      },
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
    };
    const outcome: Outcome = {
      columns: [],
      rows: [],
      rowIds: ['first', 'moving'],
      readTables: ['table'],
      truncated: false,
      insertedRowIds: [],
      changesApplied: 0,
    };
    engine.board.mockReturnValue({
      lanes: [
        {
          key: { kind: 'option', id: 'done' },
          hidden: false,
          cards: ['first'],
        },
        {
          key: { kind: 'option', id: 'todo' },
          hidden: false,
          cards: ['moving'],
        },
      ],
    });
    engine.keyBetween.mockReturnValue('a1');
    const [positions, setPositions] = createSignal<CardPosition[]>([
      { row: 'first', lane: { kind: 'option', id: 'done' }, position: 'a0' },
    ]);
    const move = vi.fn(() =>
      okAsync<CardMoved, DatabaseOpFailure>({
        positions: [
          {
            row: 'moving',
            lane: { kind: 'option', id: 'done' },
            position: 'a1',
          },
        ],
        tableVersion: 4,
      })
    );
    const onViewChange = vi.fn();
    render(() => (
      <DatabaseBoardView
        view={view}
        source={{
          columns: () => [],
          snapshot: () => undefined,
          read: () => ({ outcome, catalog: { tables: [] }, view }),
          loading: () => false,
          refreshing: () => false,
          error: () => undefined,
          refresh: () => okAsync(undefined),
          write: () => okAsync({ insertedRowIds: [], version: undefined }),
          addOption: () => okAsync(undefined),
          retain: () => {},
        }}
        rows={[
          { rowId: 'first', cells: { name: 'First card', stage: 'Done' } },
          { rowId: 'moving', cells: { name: 'Moving card', stage: 'To do' } },
        ]}
        columns={[
          {
            id: 'name',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          {
            id: 'stage',
            name: 'Stage',
            dataType: 'SELECT_STRING',
            isMultiSelect: false,
            options: [
              { id: 'done', label: 'Done', color: null },
              { id: 'todo', label: 'To do', color: null },
            ],
            writable: true,
          },
        ]}
        positions={{
          state: () => ({ kind: 'ready', positions: positions() }),
          setPositions,
          move,
        }}
        canEdit
        onViewChange={onViewChange}
        rowPending={() => false}
        createPending={() => false}
        createComplete={() => false}
        onOpen={vi.fn()}
        onCreate={vi.fn(async () => true)}
      />
    ));
    const trigger = await screen.findByRole('button', {
      name: 'Move Moving card',
    });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.keyDown(await screen.findByRole('menuitem', { name: 'Done' }), {
      key: 'Enter',
    });
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('Remove sort to arrange cards manually?')
    ).toBeTruthy();
    expect(move).not.toHaveBeenCalled();
    expect(onViewChange).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Remove sort' })
    );
    expect(onViewChange).toHaveBeenCalledWith({
      query: { filter: null, sort: [] },
    });
    expect(move).toHaveBeenCalledWith({
      row: 'moving',
      lane: { kind: 'option', id: 'done' },
      before: 'first',
      after: null,
    });
    expect(onViewChange.mock.invocationCallOrder[0]).toBeLessThan(
      move.mock.invocationCallOrder[0]
    );
    await waitFor(() => expect(dialog.hasAttribute('data-closed')).toBe(true));
    expect(cardsIn('Done')).toEqual(['first', 'moving']);
  });

  it('moves nothing when the sort prompt is cancelled', async () => {
    const view: DatabaseView = {
      id: 'view',
      databaseId: 'database',
      tableId: 'table',
      name: 'Board',
      position: 'a0',
      query: {
        filter: null,
        sort: [{ column: 'name', direction: 'ascending' }],
      },
      layout: {
        kind: 'board',
        title: 'name',
        groupBy: 'stage',
        lanes: [],
        cardFields: [],
        hideEmptyLanes: false,
      },
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
    };
    const outcome: Outcome = {
      columns: [],
      rows: [],
      rowIds: ['first', 'moving'],
      readTables: ['table'],
      truncated: false,
      insertedRowIds: [],
      changesApplied: 0,
    };
    engine.board.mockReturnValue({
      lanes: [
        {
          key: { kind: 'option', id: 'done' },
          hidden: false,
          cards: ['first'],
        },
        {
          key: { kind: 'option', id: 'todo' },
          hidden: false,
          cards: ['moving'],
        },
      ],
    });
    const [positions, setPositions] = createSignal<CardPosition[]>([
      { row: 'first', lane: { kind: 'option', id: 'done' }, position: 'a0' },
    ]);
    const setPositionsSpy = vi.fn(setPositions);
    const move = vi.fn(() =>
      okAsync<CardMoved, DatabaseOpFailure>({
        positions: [
          {
            row: 'moving',
            lane: { kind: 'option', id: 'done' },
            position: 'a1',
          },
        ],
        tableVersion: 4,
      })
    );
    const onViewChange = vi.fn();
    render(() => (
      <DatabaseBoardView
        view={view}
        source={{
          columns: () => [],
          snapshot: () => undefined,
          read: () => ({ outcome, catalog: { tables: [] }, view }),
          loading: () => false,
          refreshing: () => false,
          error: () => undefined,
          refresh: () => okAsync(undefined),
          write: () => okAsync({ insertedRowIds: [], version: undefined }),
          addOption: () => okAsync(undefined),
          retain: () => {},
        }}
        rows={[
          { rowId: 'first', cells: { name: 'First card', stage: 'Done' } },
          { rowId: 'moving', cells: { name: 'Moving card', stage: 'To do' } },
        ]}
        columns={[
          {
            id: 'name',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          {
            id: 'stage',
            name: 'Stage',
            dataType: 'SELECT_STRING',
            isMultiSelect: false,
            options: [
              { id: 'done', label: 'Done', color: null },
              { id: 'todo', label: 'To do', color: null },
            ],
            writable: true,
          },
        ]}
        positions={{
          state: () => ({ kind: 'ready', positions: positions() }),
          setPositions: setPositionsSpy,
          move,
        }}
        canEdit
        onViewChange={onViewChange}
        rowPending={() => false}
        createPending={() => false}
        createComplete={() => false}
        onOpen={vi.fn()}
        onCreate={vi.fn(async () => true)}
      />
    ));
    const trigger = await screen.findByRole('button', {
      name: 'Move Moving card',
    });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.keyDown(await screen.findByRole('menuitem', { name: 'Done' }), {
      key: 'Enter',
    });
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(dialog.hasAttribute('data-closed')).toBe(true));
    expect(move).not.toHaveBeenCalled();
    expect(onViewChange).not.toHaveBeenCalled();
    expect(setPositionsSpy).not.toHaveBeenCalled();
    expect(cardsIn('To do')).toEqual(['moving']);
    expect(cardsIn('Done')).toEqual(['first']);
  });
  it('says the board could not load when the engine fails, and loads it on Try again', async () => {
    const view: DatabaseView = {
      id: 'view',
      databaseId: 'database',
      tableId: 'table',
      name: 'Board',
      position: 'a0',
      query: { filter: null, sort: [] },
      layout: {
        kind: 'board',
        title: 'name',
        groupBy: 'stage',
        lanes: [],
        cardFields: [],
        hideEmptyLanes: false,
      },
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
    };
    const outcome: Outcome = {
      columns: [],
      rows: [],
      rowIds: ['first'],
      readTables: ['table'],
      truncated: false,
      insertedRowIds: [],
      changesApplied: 0,
    };
    engine.board.mockReturnValue({
      lanes: [
        {
          key: { kind: 'option', id: 'done' },
          hidden: false,
          cards: ['first'],
        },
      ],
    });
    loadEngine.mockRejectedValueOnce(new Error('Failed to fetch wasm'));
    render(() => (
      <DatabaseBoardView
        view={view}
        source={{
          columns: () => [],
          snapshot: () => undefined,
          read: () => ({ outcome, catalog: { tables: [] }, view }),
          loading: () => false,
          refreshing: () => false,
          error: () => undefined,
          refresh: () => okAsync(undefined),
          write: () => okAsync({ insertedRowIds: [], version: undefined }),
          addOption: () => okAsync(undefined),
          retain: () => {},
        }}
        rows={[
          { rowId: 'first', cells: { name: 'First card', stage: 'Done' } },
        ]}
        columns={[
          {
            id: 'name',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          {
            id: 'stage',
            name: 'Stage',
            dataType: 'SELECT_STRING',
            isMultiSelect: false,
            options: [{ id: 'done', label: 'Done', color: null }],
            writable: true,
          },
        ]}
        positions={{
          state: () => ({ kind: 'ready', positions: [] }),
          setPositions: vi.fn(),
          move: vi.fn(() =>
            okAsync<CardMoved, DatabaseOpFailure>({
              positions: [],
              tableVersion: 1,
            })
          ),
        }}
        canEdit
        rowPending={() => false}
        createPending={() => false}
        createComplete={() => false}
        onOpen={vi.fn()}
        onCreate={vi.fn(async () => true)}
      />
    ));
    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByText('This board could not be loaded')
    ).toBeTruthy();
    expect(
      within(alert).getByText('Check your connection, then try again.')
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Open First card' })
    ).toBeNull();
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('button', { name: 'Open First card' })
    ).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(loadEngine).toHaveBeenCalledTimes(2);
  });

  it('says the board could not load when its card places fail, and asks for them again', async () => {
    const view: DatabaseView = {
      id: 'view',
      databaseId: 'database',
      tableId: 'table',
      name: 'Board',
      position: 'a0',
      query: { filter: null, sort: [] },
      layout: {
        kind: 'board',
        title: 'name',
        groupBy: 'stage',
        lanes: [],
        cardFields: [],
        hideEmptyLanes: false,
      },
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
    };
    const outcome: Outcome = {
      columns: [],
      rows: [],
      rowIds: ['first'],
      readTables: ['table'],
      truncated: false,
      insertedRowIds: [],
      changesApplied: 0,
    };
    engine.board.mockReturnValue({
      lanes: [
        {
          key: { kind: 'option', id: 'done' },
          hidden: false,
          cards: ['first'],
        },
      ],
    });
    const [places, setPlaces] = createSignal<BoardPositionsState>({
      kind: 'loading',
    });
    const retry = vi.fn(() => setPlaces({ kind: 'ready', positions: [] }));
    render(() => (
      <DatabaseBoardView
        view={view}
        source={{
          columns: () => [],
          snapshot: () => undefined,
          read: () => ({ outcome, catalog: { tables: [] }, view }),
          loading: () => false,
          refreshing: () => false,
          error: () => undefined,
          refresh: () => okAsync(undefined),
          write: () => okAsync({ insertedRowIds: [], version: undefined }),
          addOption: () => okAsync(undefined),
          retain: () => {},
        }}
        rows={[
          { rowId: 'first', cells: { name: 'First card', stage: 'Done' } },
        ]}
        columns={[
          {
            id: 'name',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          {
            id: 'stage',
            name: 'Stage',
            dataType: 'SELECT_STRING',
            isMultiSelect: false,
            options: [{ id: 'done', label: 'Done', color: null }],
            writable: true,
          },
        ]}
        positions={{
          state: places,
          setPositions: vi.fn(),
          move: vi.fn(() =>
            okAsync<CardMoved, DatabaseOpFailure>({
              positions: [],
              tableVersion: 1,
            })
          ),
        }}
        canEdit
        rowPending={() => false}
        createPending={() => false}
        createComplete={() => false}
        onOpen={vi.fn()}
        onCreate={vi.fn(async () => true)}
      />
    ));
    expect(
      await screen.findByRole('status', { name: 'Loading board' })
    ).toBeTruthy();
    setPlaces({ kind: 'failed', retry });
    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByText('This board could not be loaded')
    ).toBeTruthy();
    expect(
      within(alert).getByText('The order of its cards could not be read.')
    ).toBeTruthy();
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(
      await screen.findByRole('button', { name: 'Open First card' })
    ).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
