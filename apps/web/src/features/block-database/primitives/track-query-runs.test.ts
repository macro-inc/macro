import type { DatabaseView } from '@service-storage/generated/schemas/databaseView';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const track = vi.hoisted(() => vi.fn());
vi.mock('@app/lib/analytics', () => ({ analytics: { track } }));

import { trackQueryRuns } from './track-query-runs';

const view = (id: string, sortKeys = 0): DatabaseView => ({
  id,
  databaseId: 'db',
  tableId: 'tasks',
  name: id,
  position: '80',
  layout: { kind: 'table', columns: [] },
  query: {
    filter: null,
    sort: Array.from({ length: sortKeys }, (_, index) => ({
      column: `column-${index}`,
      direction: 'ascending' as const,
    })),
  },
  createdAt: '2026-10-21T00:00:00Z',
  updatedAt: '2026-10-21T00:00:00Z',
});

beforeEach(() => {
  vi.useFakeTimers();
  track.mockClear();
});
afterEach(() => vi.useRealTimers());

function mount(initial: DatabaseView) {
  return createRoot((dispose) => {
    const [current, setCurrent] = createSignal(initial);
    trackQueryRuns({
      databaseId: 'db',
      tableId: 'tasks',
      host: 'document',
      view: current,
    });
    return { setCurrent, dispose };
  });
}

it('reports an open per view, including a switch to another view', () => {
  const grid = mount(view('board'));
  grid.setCurrent(view('backlog'));

  expect(track.mock.calls).toEqual([
    [
      'database_query_run',
      {
        databaseId: 'db',
        tableId: 'tasks',
        viewId: 'board',
        host: 'document',
        trigger: 'open',
        filterConditions: 0,
        sortKeys: 0,
      },
    ],
    [
      'database_query_run',
      expect.objectContaining({ viewId: 'backlog', trigger: 'open' }),
    ],
  ]);
  grid.dispose();
});

it('reports a query change once it settles', () => {
  const grid = mount(view('board'));
  track.mockClear();

  grid.setCurrent(view('board', 1));
  grid.setCurrent(view('board', 2));
  vi.advanceTimersByTime(999);
  expect(track).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);

  expect(track).toHaveBeenCalledExactlyOnceWith(
    'database_query_run',
    expect.objectContaining({ trigger: 'query_change', sortKeys: 2 })
  );
  grid.dispose();
});

it('reports a change still settling when the grid closes', () => {
  const grid = mount(view('board'));
  track.mockClear();

  grid.setCurrent(view('board', 1));
  grid.dispose();

  expect(track).toHaveBeenCalledExactlyOnceWith(
    'database_query_run',
    expect.objectContaining({ trigger: 'query_change', sortKeys: 1 })
  );
});
