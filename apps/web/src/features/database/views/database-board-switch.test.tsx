import '../tests/board-layout';
import type { CardPosition } from '@service-storage/generated/schemas/cardPosition';
import type { DatabaseView } from '@service-storage/generated/schemas/databaseView';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { okAsync, ResultAsync } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  Board,
  Catalog,
  Outcome,
} from '../../../lib/core/database-sql/generated/types';
import type { CardMoved } from '../core/view-state';
import type { DatabaseOpFailure } from '../core/write-failure';
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
      if (this.hasAttribute('data-kanban-board-viewport'))
        return new DOMRect(0, 0, 880, 500);
      const lane = this.closest('[data-kanban-lane]');
      const x = lane?.getAttribute('aria-label') === 'To do lane' ? 300 : 0;
      const card = this.hasAttribute('data-kanban-card-layout')
        ? this.querySelector('[data-kanban-card]')
        : this;
      const cardIndex = lane
        ? Array.from(lane.querySelectorAll('[data-kanban-card]')).indexOf(card!)
        : 0;
      return this.hasAttribute('data-row-id') ||
        this.hasAttribute('data-kanban-card-layout')
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

it.each(['success', 'refusal', 'sort prompt'] as const)(
  'isolates board interaction state after %s',
  async (settlement) => {
    const initialView: DatabaseView = {
      id: 'view',
      databaseId: 'database',
      tableId: 'table',
      name: 'Board',
      position: 'a0',
      query: {
        filter: null,
        sort:
          settlement === 'sort prompt'
            ? [{ column: 'name', direction: 'ascending' }]
            : [],
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
    const [view, setView] = createSignal(initialView);
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
    const answer = Promise.withResolvers<CardMoved>();
    const move = vi.fn(() =>
      ResultAsync.fromPromise(
        answer.promise,
        (): DatabaseOpFailure => ({
          kind: 'ops',
          error: { code: 'INVALID_OP', message: 'Refused', refusal: null },
        })
      )
    );
    render(() => (
      <DatabaseBoardView
        view={view()}
        source={{
          columns: () => [],
          snapshot: () => undefined,
          read: () => ({ outcome, catalog: { tables: [] }, view: view() }),
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
          get viewId() {
            return view().id;
          },
          state: () => ({ kind: 'ready', positions: [] }),
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
    fireEvent.mouseDown(card, { button: 0, clientX: 560, clientY: 80 });
    fireEvent.mouseMove(document, { clientX: 30, clientY: 150 });
    fireEvent.mouseUp(document, { button: 0, clientX: 30, clientY: 150 });
    if (settlement === 'sort prompt') {
      await screen.findByRole('dialog', {
        name: 'Remove sort to arrange cards manually?',
      });
      setView({ ...initialView, id: 'other-view' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(move).not.toHaveBeenCalled();
      await screen.findByRole('button', { name: 'Open Moving card' });
      expect(cardsIn('To do')).toEqual(['moving']);
      return;
    }
    expect(move).toHaveBeenCalledWith({
      row: 'moving',
      lane: { kind: 'option', id: 'done' },
      before: 'first',
      after: 'last',
    });
    expect(cardsIn('Done')).toEqual(['first', 'moving', 'last']);
    // A cache refresh of the same view must preserve its unfinished move.
    setView({ ...initialView, name: 'Renamed board' });
    expect(cardsIn('Done')).toEqual(['first', 'moving', 'last']);
    // Both boards already have rows and positions; no loading state remounts them.
    setView({ ...initialView, id: 'other-view', name: 'Other board' });
    await screen.findByRole('button', { name: 'Open Moving card' });
    expect(cardsIn('Done')).toEqual(['first', 'last']);
    expect(cardsIn('To do')).toEqual(['moving']);
    if (settlement === 'success')
      answer.resolve({ positions: [], tableVersion: 8 });
    else answer.reject(new Error('Refused'));
    await move.mock.results[0].value;
    expect(cardsIn('Done')).toEqual(['first', 'last']);
    expect(cardsIn('To do')).toEqual(['moving']);
  }
);
