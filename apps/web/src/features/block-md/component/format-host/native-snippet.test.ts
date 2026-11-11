/** @vitest-environment jsdom */
import { createRoot } from 'solid-js';
import { afterEach, expect, test, vi } from 'vitest';
import { createNativeFormattingActions } from './native-actions';
import { createNativeDocumentFormattingObserver } from './native-observer';
import * as snippetModule from './native-snippet';
import { mount, select } from './native-test-fixture';

const toast = vi.hoisted(() => ({ failure: vi.fn(), success: vi.fn() }));
vi.mock('@core/component/Toast/Toast', () => ({ toast }));
const failSnippet = vi.hoisted(() => ({ next: false }));
vi.mock('./native-snippet', async (original) => {
  const actual = await original<typeof import('./native-snippet')>();
  return {
    ...actual,
    createNativeSnippetLink: (
      ...args: Parameters<typeof actual.createNativeSnippetLink>
    ) => {
      if (failSnippet.next) {
        failSnippet.next = false;
        throw new Error('injected snippet construction failure');
      }
      return actual.createNativeSnippetLink(...args);
    },
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  toast.failure.mockReset();
  toast.success.mockReset();
});

/** Two text nodes with durable ids, as stored documents carry them. */
function state() {
  return JSON.stringify({
    root: {
      type: 'root',
      version: 1,
      children: [
        {
          type: 'paragraph',
          version: 1,
          $: { id: 'paraOne1' },
          children: [
            {
              type: 'text',
              version: 1,
              text: 'Alpha beta gamma',
              $: { id: 'textOne1' },
            },
          ],
        },
        {
          type: 'paragraph',
          version: 1,
          $: { id: 'paraTwo2' },
          children: [
            {
              type: 'text',
              version: 1,
              text: 'Second line',
              $: { id: 'textTwo2' },
            },
          ],
        },
      ],
    },
  });
}

function setup() {
  let bridge:
    | ReturnType<typeof createNativeDocumentFormattingObserver>
    | undefined;
  const runtime = mount([
    {
      published: (view) => bridge?.observer.published(view),
      unavailable: (reason) => bridge?.observer.unavailable(reason),
      retired: () => bridge?.observer.retired(),
    },
  ]);
  let dispose = () => {};
  createRoot((stop) => {
    dispose = stop;
    bridge = createNativeDocumentFormattingObserver({
      canEdit: () => true,
      alive: () => true,
      snippetLink: { documentId: () => 'doc-id' },
    });
  });
  const cleanup = async () => {
    dispose();
    await runtime.close();
    runtime.root.remove();
  };
  return { runtime, bridge: () => bridge, cleanup };
}

function clipboard(write: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(write) },
  });
  return navigator.clipboard.writeText as ReturnType<typeof vi.fn>;
}

test('a copied snippet link carries the model location and resets on an actual selection change', async () => {
  const { runtime, bridge, cleanup } = setup();
  try {
    runtime.port.setState(state());
    select(runtime, 'Alpha beta gamma');
    const link = bridge()?.snippetLink();
    if (!link) throw new Error('snippet link controller');
    const write = clipboard(async () => {});
    await link.copy();
    const url = new URL(write.mock.calls[0]?.[0] as string);
    expect(url.pathname).toBe('/app/md/doc-id');
    expect([...url.searchParams.entries()]).toEqual([
      ['location', 'textOne1.0.16'],
    ]);
    expect(link.copied()).toBe(true);
    expect(toast.failure).not.toHaveBeenCalled();
    select(runtime, 'Second line');
    expect(link.copied()).toBe(false);
  } finally {
    await cleanup();
  }
});

test('a commit that keeps the selection keeps the copied icon', async () => {
  const { runtime, bridge, cleanup } = setup();
  try {
    runtime.port.setState(state());
    select(runtime, 'Alpha beta gamma');
    const link = bridge()?.snippetLink();
    if (!link) throw new Error('snippet link controller');
    clipboard(async () => {});
    await link.copy();
    expect(link.copied()).toBe(true);
    const actions = createNativeFormattingActions(
      runtime.view,
      () => true,
      () => true
    );
    const before = runtime.view.selection().selection;
    await actions.text('bold');
    // Only valid as a no-change control while the range itself is unchanged.
    expect(runtime.view.selection().selection).toEqual(before);
    expect(link.copied()).toBe(true);
  } finally {
    await cleanup();
  }
});

test('without a location the bare document URL is copied, as Source does', async () => {
  const { runtime, bridge, cleanup } = setup();
  try {
    runtime.port.setState(state());
    const link = bridge()?.snippetLink();
    if (!link) throw new Error('snippet link controller');
    const write = clipboard(async () => {});
    await link.copy();
    const url = new URL(write.mock.calls[0]?.[0] as string);
    expect(url.pathname).toBe('/app/md/doc-id');
    expect([...url.searchParams.keys()]).toEqual([]);
  } finally {
    await cleanup();
  }
});

test('a rejected clipboard write toasts and keeps the link icon', async () => {
  const { runtime, bridge, cleanup } = setup();
  try {
    runtime.port.setState(state());
    select(runtime, 'Alpha beta gamma');
    const link = bridge()?.snippetLink();
    if (!link) throw new Error('snippet link controller');
    clipboard(async () => {
      throw new DOMException('denied', 'NotAllowedError');
    });
    await link.copy();
    expect(toast.failure).toHaveBeenCalledWith('Could not copy link');
    expect(link.copied()).toBe(false);
  } finally {
    await cleanup();
  }
});

test('retirement disposes the actual snippet controller and its reset timer', async () => {
  const { runtime, bridge, cleanup } = setup();
  try {
    runtime.port.setState(state());
    select(runtime, 'Alpha beta gamma');
    const link = bridge()?.snippetLink();
    if (!link) throw new Error('snippet link controller');
    clipboard(async () => {});
    vi.useFakeTimers();
    await link.copy();
    expect(vi.getTimerCount()).toBe(1);
    bridge()?.observer.retired();
    expect(bridge()?.snippetLink()).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    // A late completion after retirement cannot revive the icon.
    clipboard(async () => {});
    await link.copy();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
    await cleanup();
  }
});

test('a failed snippet construction releases the formatting host it follows', async () => {
  failSnippet.next = true;
  const remove = vi.spyOn(HTMLElement.prototype, 'removeEventListener');
  const { runtime, bridge, cleanup } = setup();
  try {
    runtime.port.setState(state());
    expect(bridge()?.controller()).toBeUndefined();
    expect(bridge()?.snippetLink()).toBeUndefined();
    expect(
      remove.mock.calls.filter(([name]) => name === 'focusin')
    ).toHaveLength(1);
    expect(
      remove.mock.calls.filter(([name]) => name === 'focusout')
    ).toHaveLength(1);
  } finally {
    await cleanup();
  }
});

test('malformed snippet replies are rejected before use', () => {
  const view = { mirror: { keyGeneration: 0 }, port: { query: vi.fn() } };
  const reply = (value: unknown) =>
    view.port.query.mockReturnValueOnce({ text: JSON.stringify(value) });
  const read = () =>
    snippetModule.readNativeSelectionSnippet(
      view as unknown as Parameters<
        typeof snippetModule.readNativeSelectionSnippet
      >[0]
    );
  const good = {
    location: { anchor: { id: 'a', offset: 1 }, focus: { id: 'a', offset: 2 } },
    text: 'x',
    end: { key: 3, offset: 2, type: 'text' },
  };
  reply(null);
  expect(read()).toBeNull();
  for (const bad of [
    { ...good, end: { ...good.end, key: -1 } },
    { ...good, end: { ...good.end, offset: 1.5 } },
    { ...good, end: { ...good.end, key: 2 ** 32 } },
    { ...good, end: { ...good.end, type: 'node' } },
    { ...good, location: { ...good.location, focus: { id: 'a', offset: -1 } } },
  ]) {
    reply(bad);
    expect(read, JSON.stringify(bad)).toThrow(
      'Invalid selection snippet query'
    );
  }
});
