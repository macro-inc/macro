import { queryReadyGate } from '@queries/gate';
import type { CardPosition } from '@service-storage/generated/schemas/cardPosition';
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { QueryClient } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { usePipelinePositionsQuery } from './pipeline-views';

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
});

it('reads saved order on a fresh mount and separates each board query', async () => {
  const saved: CardPosition[] = [
    { row: 'second', lane: { kind: 'option', id: 'lead' }, position: '40' },
  ];
  const read = vi.fn(async (_pipeline: string, view: string) =>
    ok(view === 'board-one' ? saved : [])
  );
  const [view, setView] = createSignal<string>();
  function mount() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    clients.push(client);
    return render(() => {
      const query = usePipelinePositionsQuery(
        { client, storage: { getCrmPipelineViewPositions: read } },
        'sales',
        view
      );
      return (
        <output aria-label="Saved order">
          {queryReadyGate(query) ? JSON.stringify(query.data) : 'Loading'}
        </output>
      );
    });
  }
  const first = mount();
  expect(read).not.toHaveBeenCalled();
  setView('board-one');
  await waitFor(() =>
    expect(screen.getByLabelText('Saved order').textContent).toBe(
      JSON.stringify(saved)
    )
  );
  setView('board-two');
  await waitFor(() =>
    expect(screen.getByLabelText('Saved order').textContent).toBe('[]')
  );
  expect(read.mock.calls).toEqual([
    ['sales', 'board-one'],
    ['sales', 'board-two'],
  ]);
  first.unmount();
  setView('board-one');
  mount();
  await waitFor(() =>
    expect(screen.getByLabelText('Saved order').textContent).toBe(
      JSON.stringify(saved)
    )
  );
  expect(read).toHaveBeenCalledTimes(3);
});

it('reports a failed positions read instead of drawing an empty order', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  render(() => {
    const query = usePipelinePositionsQuery(
      {
        client,
        storage: {
          getCrmPipelineViewPositions: async () =>
            err([{ code: 'FORBIDDEN', message: 'Forbidden' }]),
        },
      },
      'sales',
      () => 'board'
    );
    return (
      <output aria-label="State">
        {query.isError ? 'Failed' : queryReadyGate(query) ? 'Ready' : 'Loading'}
      </output>
    );
  });
  await waitFor(() =>
    expect(screen.getByLabelText('State').textContent).toBe('Failed')
  );
});
