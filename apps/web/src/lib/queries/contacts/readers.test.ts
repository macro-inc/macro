import { afterEach, beforeEach, expect, it, vi } from 'vitest';

class MockBroadcastChannel {
  static instance: MockBroadcastChannel | undefined;
  readonly postMessage = vi.fn();
  private handler: ((event: { data: unknown }) => void) | undefined;

  constructor(readonly name: string) {
    MockBroadcastChannel.instance = this;
  }

  addEventListener(_type: string, handler: (event: { data: unknown }) => void) {
    this.handler = handler;
  }

  emit(data: unknown) {
    this.handler?.({ data });
  }
}

// Each test loads a fresh module: its tab id, counts and listener are per tab.
async function loadTab() {
  vi.resetModules();
  return import('./readers');
}
const sent = () =>
  MockBroadcastChannel.instance?.postMessage.mock.calls.map(
    ([message]) => message
  ) ?? [];
const fromOtherTab = (message: object) =>
  MockBroadcastChannel.instance?.emit({ tab: 'other-tab', ...message });

beforeEach(() => {
  localStorage.clear();
  MockBroadcastChannel.instance = undefined;
  vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

it('counts this tab’s windows, announcing only the first open and last close', async () => {
  const { openContactReader, watchContactReaders } = await loadTab();
  const readersOpen = watchContactReaders();
  expect(readersOpen()).toBe(false);

  const first = openContactReader();
  const second = openContactReader();
  expect(readersOpen()).toBe(true);
  first();
  first();
  expect(readersOpen()).toBe(true);
  second();
  expect(readersOpen()).toBe(false);

  expect(sent().map(({ kind, open }) => [kind, open])).toEqual([
    ['roll-call', undefined],
    ['readers', true],
    ['readers', false],
  ]);
});

it('follows windows another tab opens and closes, in order', async () => {
  const { watchContactReaders } = await loadTab();
  const readersOpen = watchContactReaders();

  fromOtherTab({ kind: 'readers', seq: 1, open: true });
  expect(readersOpen()).toBe(true);
  fromOtherTab({ kind: 'readers', seq: 2, open: false });
  expect(readersOpen()).toBe(false);
  fromOtherTab({ kind: 'readers', seq: 1, open: true });
  expect(readersOpen()).toBe(false);
});

it('tells a tab that starts listening about a window already open here', async () => {
  const { openContactReader } = await loadTab();
  const release = openContactReader();
  MockBroadcastChannel.instance?.postMessage.mockClear();

  fromOtherTab({ kind: 'roll-call', seq: 1 });
  expect(sent()).toEqual([
    expect.objectContaining({ kind: 'readers', open: true }),
  ]);

  release();
  MockBroadcastChannel.instance?.postMessage.mockClear();
  fromOtherTab({ kind: 'roll-call', seq: 2 });
  expect(sent()).toEqual([]);
});

it('announces open windows as closed when the page goes away, and back when it returns', async () => {
  const { openContactReader } = await loadTab();
  openContactReader();
  MockBroadcastChannel.instance?.postMessage.mockClear();

  window.dispatchEvent(
    new PageTransitionEvent('pagehide', { persisted: true })
  );
  window.dispatchEvent(
    new PageTransitionEvent('pageshow', { persisted: true })
  );
  expect(sent()).toEqual([
    expect.objectContaining({ kind: 'readers', open: false }),
    expect.objectContaining({ kind: 'readers', open: true }),
    expect.objectContaining({ kind: 'roll-call' }),
  ]);
});
