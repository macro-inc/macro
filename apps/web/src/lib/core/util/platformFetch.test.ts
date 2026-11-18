import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const nativeFetch = vi.hoisted(() => vi.fn<typeof fetch>());
const platform = vi.hoisted(() => ({ native: true }));
vi.mock('../constant/servers', () => ({
  NATIVE_SESSION_SERVICE_URLS: [
    new URL('/auth', document.baseURI).href,
    'http://127.0.0.1:3006/sync',
  ],
  SERVER_HOSTS: {},
  SYNC_SERVICE_HOSTS: { worker: 'https://sync.example' },
}));
vi.mock('./platform', () => ({ isTauri: () => platform.native }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: nativeFetch }));

import {
  createPlatformFetch,
  initializePlatformFetch,
  installPlatformFetch,
  platformFetch,
  webviewFetch,
} from './platformFetch';
import { safeFetch } from './safeFetch';

beforeEach(() => {
  platform.native = true;
  vi.stubGlobal('__TAURI_INTERNALS__', {
    convertFileSrc: (path: string) =>
      `ipc://localhost/${encodeURIComponent(path)}`,
  });
  nativeFetch.mockReset().mockResolvedValue(new Response('native'));
});

afterEach(() => vi.unstubAllGlobals());

it.each([
  'ipc://localhost/',
  'http://ipc.localhost/',
  'https://ipc.localhost/',
])(
  'keeps real invoke dispatch on the browser-owned IPC endpoint %s',
  async (endpoint) => {
    vi.stubGlobal('__TAURI_INTERNALS__', {
      convertFileSrc: (path: string) =>
        `${endpoint}${encodeURIComponent(path)}`,
      invoke: async (command: string, args: unknown) => {
        const response = await fetch(convertFileSrc(command, 'ipc'), {
          method: 'POST',
          body: JSON.stringify(args),
        });
        return response.json();
      },
    });
    const browser = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ available: true }));
    nativeFetch.mockImplementation(async () => {
      // Bound the broken recursive path so this regression cannot exhaust memory.
      if (nativeFetch.mock.calls.length > 1)
        throw new Error('Recursive IPC fetch');
      await invoke('plugin:http|fetch', {});
      return Response.json({ available: true });
    });
    vi.stubGlobal('fetch', initializePlatformFetch(browser));
    await expect(invoke('read_desktop_diagnostics')).resolves.toEqual({
      available: true,
    });
    expect(browser).toHaveBeenCalledTimes(1);
    expect(nativeFetch).not.toHaveBeenCalled();
  }
);

it.each([
  '/asset.wasm',
  'data:text/plain,hello',
  'blob:http://localhost/image',
])('keeps browser-compatible %s off the bridge', async (url) => {
  const browser = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response('browser'));
  expect(await (await createPlatformFetch(browser)(url)).text()).toBe(
    'browser'
  );
  expect(nativeFetch).not.toHaveBeenCalled();
});

it('keeps remote authentication and arbitrary email images on the native transport', async () => {
  const browser = vi.fn<typeof fetch>();
  const request = createPlatformFetch(browser);
  await request('https://gateway.example/auth', { credentials: 'include' });
  await request('https://images.example/image?localhost=true');
  await request('http://127.0.0.1:3006/dev');
  await request('http://[::1]:3006/dev');
  await request('ipc://other-host/command');
  await request('https://ipc.localhost.example/command');
  expect(nativeFetch).toHaveBeenCalledTimes(6);
  expect(browser).not.toHaveBeenCalled();
});

it('passes the abort signal of a Request to the native transport', async () => {
  const request = createPlatformFetch(vi.fn<typeof fetch>());
  const requestAbort = new AbortController();
  const initAbort = new AbortController();
  const input = new Request('https://gateway.example/auth', {
    signal: requestAbort.signal,
  });
  await request(input);
  await request(input, { signal: initAbort.signal });
  // A Request copies its signal, so assert on the abort reaching the transport.
  const [fromRequest, fromInit] = nativeFetch.mock.calls.map(
    ([, init]) => init?.signal
  );
  requestAbort.abort();
  expect(fromRequest?.aborted).toBe(true);
  expect(fromInit).toBe(initAbort.signal);
});

it('uses the captured browser fetch after the global override', async () => {
  const browser = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response('browser'));
  const request = initializePlatformFetch(browser);
  vi.stubGlobal('fetch', request);
  try {
    await fetch(new URL('/asset.wasm', document.baseURI));
    await platformFetch('https://gateway.example/auth');
    await webviewFetch('https://public-api.example/search');
    expect(browser).toHaveBeenCalledTimes(2);
    expect(nativeFetch).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('keeps configured local and same-origin APIs on the native cookie jar', async () => {
  const browser = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response('browser'));
  const request = createPlatformFetch(browser);
  await request(new URL('/auth/login/passwordless', document.baseURI));
  await request('http://127.0.0.1:3006/sync/snapshot');
  expect(nativeFetch).toHaveBeenCalledTimes(2);
  expect(browser).not.toHaveBeenCalled();
  await request(new URL('/auth-assets/icon.png', document.baseURI));
  expect(browser).toHaveBeenCalledTimes(1);
});

it('routes the installed global fetch to the native transport without recursing', async () => {
  const browser = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response('browser'));
  vi.stubGlobal('fetch', browser);
  installPlatformFetch();
  await fetch('https://gateway.example/auth/user/legacy_user_permissions');
  await platformFetch('https://gateway.example/auth/jwt/macro_api_token');
  await fetch('https://api.klipy.com/v2/search');
  expect(nativeFetch).toHaveBeenCalledTimes(2);
  expect(browser).toHaveBeenCalledTimes(1);
});

it.each([
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm/vision_wasm_internal.wasm',
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
])('keeps call background effect assets on the webview %s', async (url) => {
  const browser = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response('browser'));
  vi.stubGlobal('fetch', browser);
  installPlatformFetch();
  await fetch(url);
  expect(nativeFetch).not.toHaveBeenCalled();
  expect(browser).toHaveBeenCalledTimes(1);
});

it('routes installed loopback and localhost-named URLs by service and origin', async () => {
  const browser = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response('browser'));
  vi.stubGlobal('fetch', browser);
  installPlatformFetch();
  await fetch('/auth/user/legacy_user_permissions');
  await fetch('https://images.example/image?localhost=true');
  await fetch('/src/index.tsx');
  expect(nativeFetch).toHaveBeenCalledTimes(2);
  expect(browser).toHaveBeenCalledTimes(1);
});

it.each([
  'asset://localhost/',
  'http://asset.localhost/',
  'https://asset.localhost/',
])(
  'keeps installed fetches of local files on the webview asset protocol %s',
  async (endpoint) => {
    vi.stubGlobal('__TAURI_INTERNALS__', {
      convertFileSrc: (path: string, protocol: string) =>
        `${endpoint.replace('asset', protocol)}${encodeURIComponent(path)}`,
    });
    const browser = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('browser'));
    vi.stubGlobal('fetch', browser);
    installPlatformFetch();
    await fetch(convertFileSrc('/media/preview.jpg'));
    expect(browser).toHaveBeenCalledTimes(1);
    expect(nativeFetch).not.toHaveBeenCalled();
  }
);

it('reports a native request that gets no response as a network error', async () => {
  const failure =
    'error sending request for url (https://sync.example/document/1/exists)';
  nativeFetch.mockRejectedValue(failure);
  vi.stubGlobal('fetch', initializePlatformFetch(vi.fn<typeof fetch>()));

  await expect(platformFetch('https://sync.example/')).rejects.toThrow(
    new TypeError(failure)
  );
  const result = await safeFetch('https://sync.example/document/1/exists', {
    method: 'HEAD',
  });
  expect(result._unsafeUnwrapErr()).toEqual([
    { code: 'NETWORK_ERROR', message: 'Network error occurred' },
  ]);
});

it('keeps a cancelled native request out of network errors', async () => {
  const controller = new AbortController();
  controller.abort();
  nativeFetch.mockRejectedValue('Request canceled');
  vi.stubGlobal('fetch', initializePlatformFetch(vi.fn<typeof fetch>()));

  await expect(
    platformFetch('https://sync.example/', { signal: controller.signal })
  ).rejects.toBe('Request canceled');
});
