// @vitest-environment node
import { fetch } from '@tauri-apps/plugin-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Args = { rid: number };

/** Mirrors tauri-plugin-http's resource table: the body resource closes at
 *  end of stream, and closing an already-closed id rejects. */
function fakeHttpBridge(body: string) {
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
      status: 200,
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
  return async (cmd: string, args: Args) => commands[cmd](args);
}

let unhandled: unknown[];
const recordUnhandled = (reason: unknown) => unhandled.push(reason);

beforeEach(() => {
  unhandled = [];
  process.on('unhandledRejection', recordUnhandled);
  vi.stubGlobal('window', {
    __TAURI_INTERNALS__: { invoke: fakeHttpBridge('ok') },
  });
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
});
