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
import { err, ok, okAsync, type Result, ResultAsync } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('pending board moves', () => {
  it.each([true, false])(
    'preserves saved order when a move is refused and the later move succeeds=%s',
    async (laterSucceeds) => {
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
        { row: 'moving', lane: { kind: 'option', id: 'todo' }, position: 'a2' },
      ]);
      const replies: ((reply: Result<CardMoved, DatabaseOpFailure>) => void)[] =
        [];
      const move = vi.fn(
        () =>
          new ResultAsync<CardMoved, DatabaseOpFailure>(
            new Promise((resolve) => replies.push(resolve))
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
      expect(positions()).toEqual([
        { row: 'first', lane: { kind: 'option', id: 'done' }, position: 'a0' },
        { row: 'moving', lane: { kind: 'option', id: 'todo' }, position: 'a2' },
      ]);
      expect(cardsIn('Done')).toEqual(['first', 'moving']);
      const nextTrigger = screen.getByRole('button', {
        name: 'Move First card',
      });
      nextTrigger.focus();
      fireEvent.keyDown(nextTrigger, { key: 'Enter' });
      fireEvent.keyDown(
        await screen.findByRole('menuitem', { name: 'To do' }),
        {
          key: 'Enter',
        }
      );
      await waitFor(() => expect(move).toHaveBeenCalledTimes(2));
      expect(cardsIn('Done')).toEqual(['moving']);
      expect(cardsIn('To do')).toEqual(['first']);

      replies[0](err({ kind: 'unexpected-result' }));
      await waitFor(() => expect(toastFailure).toHaveBeenCalledTimes(1));
      expect(cardsIn('Done')).toEqual([]);
      expect(cardsIn('To do')).toEqual(['moving', 'first']);
      expect(positions()).toEqual([
        { row: 'first', lane: { kind: 'option', id: 'done' }, position: 'a0' },
        { row: 'moving', lane: { kind: 'option', id: 'todo' }, position: 'a2' },
      ]);

      if (laterSucceeds) {
        replies[1](
          ok({
            positions: [
              {
                row: 'first',
                lane: { kind: 'option', id: 'todo' },
                position: 'a3',
              },
            ],
            tableVersion: 8,
          })
        );
        await waitFor(() =>
          expect(positions()).toEqual([
            {
              row: 'moving',
              lane: { kind: 'option', id: 'todo' },
              position: 'a2',
            },
            {
              row: 'first',
              lane: { kind: 'option', id: 'todo' },
              position: 'a3',
            },
          ])
        );
        expect(cardsIn('To do')).toEqual(['moving', 'first']);
      } else {
        replies[1](err({ kind: 'unexpected-result' }));
        await waitFor(() => expect(toastFailure).toHaveBeenCalledTimes(2));
        expect(cardsIn('To do')).toEqual(['moving']);
        expect(cardsIn('Done')).toEqual(['first']);
        expect(positions()).toEqual([
          {
            row: 'first',
            lane: { kind: 'option', id: 'done' },
            position: 'a0',
          },
          {
            row: 'moving',
            lane: { kind: 'option', id: 'todo' },
            position: 'a2',
          },
        ]);
      }
    }
  );
});
