// @vitest-environment node
import { getEventListeners } from 'node:events';
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
 *  end of stream, and closing an already-closed id rejects. With `holdSend`
 *  the response never arrives, and cancelling the request fails its send. */
function fakeHttpBridge(body: string, status = 200, holdSend = false) {
  const open = new Set<number>();
  const calls: string[] = [];
  let nextRid = 0;
  let bodySent = false;
  let failSend: ((reason: string) => void) | undefined;
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
    'plugin:http|fetch_cancel': ({ rid }) => {
      requireOpen(rid);
      failSend?.('Request canceled');
    },
    'plugin:http|fetch_send': () =>
      holdSend
        ? new Promise((_, reject) => {
            failSend = reject;
          })
        : {
            status,
            statusText: 'OK',
            url: 'https://example.com/',
            headers: [],
            rid: add(),
          },
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
    calls,
    failSend: (reason: string) => failSend?.(reason),
    invoke: async (cmd: string, args: Args) => {
      calls.push(cmd.replace('plugin:http|', ''));
      return commands[cmd](args);
    },
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
  // Node reports a promise rejected in an event listener as an exception.
  process.on('uncaughtException', recordUnhandled);
  collector.registered.clear();
  useBridge(fakeHttpBridge('ok'));
});

afterEach(() => {
  process.off('unhandledRejection', recordUnhandled);
  process.off('uncaughtException', recordUnhandled);
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

describe('tauri http plugin abort signal', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  /** What the runtime's own `Request` leaves on a signal it is given. */
  const runtimeListeners = () => {
    const { signal } = new AbortController();
    new Request('https://example.com/', { signal });
    return getEventListeners(signal, 'abort').length;
  };

  it('cancels the native request when the signal aborts before the response', async () => {
    const bridge = useBridge(fakeHttpBridge('ok', 200, true));
    const controller = new AbortController();
    const pending = fetch('https://example.com/', {
      signal: controller.signal,
    });
    await settle();
    expect(bridge.calls).toEqual(['fetch', 'fetch_send']);

    controller.abort();

    await expect(pending).rejects.toBe('Request canceled');
    expect(bridge.calls).toContain('fetch_cancel');
    expect(unhandled).toEqual([]);
  });

  it('survives an abort for a request the native side no longer has', async () => {
    const bridge = useBridge(fakeHttpBridge('ok', 200, true));
    const controller = new AbortController();
    const pending = fetch('https://example.com/', {
      signal: controller.signal,
    });
    await settle();
    bridge.open.clear();

    controller.abort();
    await settle();

    expect(bridge.calls).toContain('fetch_cancel');
    expect(unhandled).toEqual([]);
    bridge.failSend('connection closed');
    await expect(pending).rejects.toBe('connection closed');
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
    'stops listening to the signal once the body is $name',
    async ({ finish }) => {
      const bridge = useBridge(fakeHttpBridge('ok'));
      const controller = new AbortController();
      const response = await fetch('https://example.com/', {
        signal: controller.signal,
      });
      // One listener for the body, on top of the runtime's own.
      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(
        runtimeListeners() + 1
      );

      await finish(response);
      await settle();
      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(
        runtimeListeners()
      );

      const callsBefore = [...bridge.calls];
      controller.abort();
      await settle();
      expect(bridge.calls).toEqual(callsBefore);
    }
  );
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

  it('survives releasing a response the native side already closed', async () => {
    const bridge = useBridge(fakeHttpBridge('ok'));
    await fetch('https://example.com/');
    await settle();
    const [{ collect }] = watched();

    collect();
    collect();
    await settle();

    expect(
      bridge.calls.filter((call) => call === 'fetch_cancel_body')
    ).toHaveLength(2);
    expect(unhandled).toEqual([]);
  });

  it('survives cancelling a body the native side already closed', async () => {
    const bridge = useBridge(fakeHttpBridge('ok'));
    const response = await fetch('https://example.com/');
    await settle();
    bridge.open.clear();

    await response.body?.cancel();
    await settle();

    expect(bridge.calls).toContain('fetch_cancel_body');
    expect(unhandled).toEqual([]);
  });

  it('reads nothing from a body until something asks for it', async () => {
    const bridge = useBridge(fakeHttpBridge('ok'));
    const response = await fetch('https://example.com/');
    await settle();

    // A read begun here would stay open until the native side answered, and
    // hold the body's callbacks with it: a response dropped while its first
    // chunk was still on the way could not be released.
    expect(bridge.calls).toEqual(['fetch', 'fetch_send']);

    expect(await response.text()).toBe('ok');
    expect(
      bridge.calls.filter((call) => call === 'fetch_read_body')
    ).toHaveLength(2);
  });

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
