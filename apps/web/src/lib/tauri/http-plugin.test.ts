// @vitest-environment node
import { fetch } from '@tauri-apps/plugin-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Args = { rid: number };

/**
 * Stands in for the garbage collector, which a test cannot run on demand. The
 * plugin creates its registry when it loads, so this is installed first.
 * Other modules create registries too, so each entry keeps its own callback.
 */
const collector = vi.hoisted(() => {
  type Entry = { target: object; held: unknown; collect: () => void };
  const registered = new Map<object, Entry>();
  globalThis.FinalizationRegistry = class {
    constructor(private release: (held: unknown) => void) {}
    register(target: object, held: unknown, token: object) {
      registered.set(token, {
        target,
        held,
        collect: () => this.release(held),
      });
    }
    unregister(token: object) {
      return registered.delete(token);
    }
  } as unknown as typeof FinalizationRegistry;
  return { registered };
});

/** Mirrors tauri-plugin-http's resource table: the body resource closes at
 *  end of stream, and closing an already-closed id rejects. */
function fakeHttpBridge(body: string, status = 200) {
  const open = new Set<number>();
  let nextRid = 0;
  let bodySent = false;
  const add = () => {
    open.add(++nextRid);
    return nextRid;
  };
  const requireOpen = (rid: number) => {
    if (!open.has(rid)) throw `The resource id ${rid} is invalid.`;
  };
  const close = (rid: number) => {
    requireOpen(rid);
    open.delete(rid);
  };
  const commands: Record<string, (args: Args) => unknown> = {
    'plugin:http|fetch': () => add(),
    'plugin:http|fetch_cancel': ({ rid }) => requireOpen(rid),
    'plugin:http|fetch_send': () => ({
      status,
      statusText: 'OK',
      url: 'https://example.com/',
      headers: [],
      rid: add(),
    }),
    'plugin:http|fetch_read_body': ({ rid }) => {
      requireOpen(rid);
      if (bodySent) {
        close(rid);
        return [1];
      }
      bodySent = true;
      return [...new TextEncoder().encode(body), 0];
    },
    'plugin:http|fetch_cancel_body': ({ rid }) => close(rid),
  };
  return {
    open,
    invoke: async (cmd: string, args: Args) => commands[cmd](args),
  };
}

function useBridge(bridge: ReturnType<typeof fakeHttpBridge>) {
  vi.stubGlobal('window', { __TAURI_INTERNALS__: { invoke: bridge.invoke } });
  return bridge;
}

let unhandled: unknown[];
const recordUnhandled = (reason: unknown) => unhandled.push(reason);

beforeEach(() => {
  unhandled = [];
  process.on('unhandledRejection', recordUnhandled);
  collector.registered.clear();
  useBridge(fakeHttpBridge('ok'));
});

afterEach(() => {
  process.off('unhandledRejection', recordUnhandled);
  vi.unstubAllGlobals();
});

describe('tauri http plugin fetch', () => {
  it.each([
    {
      name: 'reading the whole body',
      finish: async (response: Response) => {
        expect(await response.text()).toBe('ok');
      },
    },
    {
      name: 'cancelling the body',
      finish: (response: Response) => response.body?.cancel(),
    },
  ])('ignores an abort that arrives after $name', async ({ finish }) => {
    const controller = new AbortController();
    const response = await fetch('https://example.com/', {
      signal: controller.signal,
    });
    await finish(response);

    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(unhandled).toEqual([]);
  });

  it('ignores an abort that arrives while the body is streaming', async () => {
    const controller = new AbortController();
    const response = await fetch('https://example.com/', {
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    await reader.read();

    controller.abort();
    await expect(reader.read()).rejects.toBeDefined();
    await reader.cancel().catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(unhandled).toEqual([]);
  });
});

describe('tauri http plugin response bodies', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  // The plugin's registrations hold a resource id. The runtime's own fetch
  // registers a response it clones, holding something else.
  const watched = () =>
    [...collector.registered.values()].filter(
      (entry) => typeof entry.held === 'number'
    );

  it('releases the native response of a body that is collected unread', async () => {
    const bridge = useBridge(fakeHttpBridge('ok'));
    const response = await fetch('https://example.com/');
    await settle();

    // The request resource and the response resource are both still open.
    expect(bridge.open.size).toBe(2);
    // Only a resource id is held for the collector: an object that reached
    // what it watches would keep that from ever being collected.
    expect(watched()).toHaveLength(1);
    const [{ target, held, collect }] = watched();
    // It watches neither the stream nor the response. WebKit collects a stream
    // object while its response can still be read, which would release a body
    // the page goes on to read.
    expect(target).not.toBe(response.body);
    expect(target).not.toBe(response);

    collect();
    await settle();

    expect(bridge.open.has(held as number)).toBe(false);
    expect(unhandled).toEqual([]);
  });

  it.each([
    {
      name: 'read to its end',
      finish: async (response: Response) => {
        await response.text();
      },
    },
    {
      name: 'cancelled',
      finish: async (response: Response) => {
        await response.body?.cancel();
      },
    },
  ])(
    'leaves nothing for the collector once a body is $name',
    async ({ finish }) => {
      const bridge = useBridge(fakeHttpBridge('ok'));
      const response = await fetch('https://example.com/');
      await finish(response);
      await settle();

      expect(watched()).toHaveLength(0);
      // Only the request resource remains; the response was released natively.
      expect(bridge.open.size).toBe(1);
    }
  );

  it('keeps a clone readable with the address of its response', async () => {
    const bridge = useBridge(fakeHttpBridge('ok'));
    const response = await fetch('https://example.com/');
    const clone = response.clone();

    expect(clone.url).toBe('https://example.com/');
    expect(await clone.text()).toBe('ok');
    expect(await response.text()).toBe('ok');
    await settle();

    expect(watched()).toHaveLength(0);
    expect(bridge.open.size).toBe(1);
  });

  it('releases a response that has no body as soon as it arrives', async () => {
    const bridge = useBridge(fakeHttpBridge('', 204));
    const response = await fetch('https://example.com/');
    await settle();

    expect(response.body).toBeNull();
    expect(watched()).toHaveLength(0);
    expect(bridge.open.size).toBe(1);
    expect(unhandled).toEqual([]);
  });
});
