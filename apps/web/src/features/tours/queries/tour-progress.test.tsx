import { queryClient } from '@queries/client';
import type { UserKvEntry } from '@service-storage/generated/schemas/userKvEntry';
import { QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTourProgress } from './tour-progress';

const server = vi.hoisted(() => ({
  entries: [] as UserKvEntry[],
  fail: false,
  listUserKv: vi.fn(),
  putUserKv: vi.fn(),
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    listUserKv: server.listUserKv,
    putUserKv: server.putUserKv,
  },
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});

const USER = 'macro|tour-user@macro.com';
const legacyKey = (tourId: string) =>
  `macro:tour:${tourId}:${encodeURIComponent(USER)}`;

const entry = (key: string, value: Record<string, unknown>): UserKvEntry => ({
  namespace: 'tours',
  key,
  value,
  createdAt: '2026-09-30T00:00:00Z',
  updatedAt: '2026-09-30T00:00:00Z',
});

let dispose: (() => void) | undefined;

function mount(tourId: string, localOnly = false) {
  let progress!: ReturnType<typeof createTourProgress>;
  function Probe() {
    progress = createTourProgress({ tourId, userId: USER, localOnly });
    return null;
  }
  dispose = render(
    () => (
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    ),
    document.createElement('div')
  );
  return progress;
}

beforeEach(() => {
  localStorage.clear();
  server.entries = [];
  server.fail = false;
  server.listUserKv
    .mockReset()
    .mockImplementation(async () =>
      server.fail
        ? err([{ code: 'HTTP_ERROR', message: 'down' }])
        : ok(server.entries)
    );
  server.putUserKv
    .mockReset()
    .mockImplementation(
      async (vars: { key: string; value: Record<string, unknown> }) =>
        ok(entry(vars.key, vars.value))
    );
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  queryClient.clear();
});

describe('createTourProgress', () => {
  it('is not ready until the tours namespace loads, then reads this tour', async () => {
    server.entries = [
      entry('mail', { status: 'completed' }),
      entry('calendar', { status: 'active', step: 2 }),
    ];
    const progress = mount('calendar');
    expect(progress.ready()).toBe(false);
    expect(progress.stored()).toBeUndefined();

    await vi.waitFor(() => expect(progress.ready()).toBe(true));
    expect(progress.stored()).toEqual({ status: 'active', step: 2 });
    expect(server.listUserKv).toHaveBeenCalledWith({ namespace: 'tours' });
  });

  it('ignores stored values it does not recognize', async () => {
    server.entries = [entry('calendar', { status: 'active', step: -1 })];
    const progress = mount('calendar');
    await vi.waitFor(() => expect(progress.ready()).toBe(true));
    expect(progress.stored()).toBeUndefined();
  });

  it('saves progress to the tours namespace under the tour id', async () => {
    const progress = mount('calendar');
    await vi.waitFor(() => expect(progress.ready()).toBe(true));
    progress.save({ status: 'dismissed' });
    await vi.waitFor(() =>
      expect(server.putUserKv).toHaveBeenCalledWith({
        namespace: 'tours',
        key: 'calendar',
        value: { status: 'dismissed' },
      })
    );
    expect(progress.stored()).toEqual({ status: 'dismissed' });
  });

  it('uploads progress an earlier build saved in the browser, once', async () => {
    localStorage.setItem(
      legacyKey('calendar'),
      JSON.stringify({ status: 'completed' })
    );
    const progress = mount('calendar');
    await vi.waitFor(() => expect(progress.ready()).toBe(true));
    // The tour already honours it before the upload finishes.
    expect(progress.stored()).toEqual({ status: 'completed' });
    await vi.waitFor(() =>
      expect(server.putUserKv).toHaveBeenCalledWith({
        namespace: 'tours',
        key: 'calendar',
        value: { status: 'completed' },
      })
    );
  });

  it('prefers the account over the browser copy and does not re-upload', async () => {
    localStorage.setItem(
      legacyKey('calendar'),
      JSON.stringify({ status: 'completed' })
    );
    server.entries = [entry('calendar', { status: 'active', step: 1 })];
    const progress = mount('calendar');
    await vi.waitFor(() => expect(progress.ready()).toBe(true));
    expect(progress.stored()).toEqual({ status: 'active', step: 1 });
    expect(server.putUserKv).not.toHaveBeenCalled();
  });

  it('stays not ready when progress fails to load', async () => {
    server.fail = true;
    const progress = mount('calendar');
    await vi.waitFor(() => expect(server.listUserKv).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(progress.ready()).toBe(false);
  });

  it('in local-only mode reads and saves nothing', () => {
    server.entries = [entry('calendar', { status: 'dismissed' })];
    const progress = mount('calendar', true);
    expect(progress.ready()).toBe(true);
    expect(progress.stored()).toBeUndefined();
    progress.save({ status: 'completed' });
    expect(server.listUserKv).not.toHaveBeenCalled();
    expect(server.putUserKv).not.toHaveBeenCalled();
  });
});
