import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import html from './mail-projection.html?raw';

const host = vi.hoisted(() => ({
  writeQuery: vi.fn(),
  entityFilter: vi.fn(),
  readRecordsByKeys: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock('../../host/worker-host', () => ({
  createWorkerCacheHost: () => host,
}));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  document.body.innerHTML = html;
  host.writeQuery.mockResolvedValue({});
  host.entityFilter.mockResolvedValue({
    kind: 'mail-page',
    keys: [],
    sortTimestamps: [],
    nextCursor: null,
    revision: '1',
  });
  host.readRecordsByKeys.mockResolvedValue({ records: [], revision: '1' });
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  document.body.replaceChildren();
});

it.each(['entityFilter', 'readRecordsByKeys'] as const)(
  'ignores a superseded %s rejection after a newer refresh succeeds',
  async (method) => {
    await import('./mail-projection-harness');
    const result = document.querySelector('#result')!;
    const view = document.querySelector<HTMLSelectElement>('#view')!;
    let reject!: (error: Error) => void;
    host[method].mockImplementationOnce(
      () =>
        new Promise((_, rejectPromise) => {
          reject = rejectPromise;
        })
    );
    view.value = 'DRAFTS';
    view.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(host[method]).toHaveBeenCalledTimes(2));

    view.value = 'SENT';
    view.dispatchEvent(new Event('change'));
    await vi.waitFor(() =>
      expect(host.readRecordsByKeys).toHaveBeenCalledTimes(
        method === 'entityFilter' ? 2 : 3
      )
    );
    expect(result.getAttribute('data-status')).toBe('ready');
    reject(new Error('superseded refresh failed'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.getAttribute('data-status')).toBe('ready');
    expect(result.textContent).toBe('0 cached emails shown');
  }
);
