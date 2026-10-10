import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  nativeFetch: vi.fn<typeof fetch>(),
}));
vi.mock('./platform', () => ({ isTauri: mocks.isTauri }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: mocks.nativeFetch }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function setup(baseUrl = 'tauri://localhost/app/index.html') {
  const browserFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response());
  const nativeFetch = mocks.nativeFetch
    .mockReset()
    .mockResolvedValue(new Response());
  mocks.isTauri.mockReturnValue(true);
  vi.stubGlobal('fetch', browserFetch);
  vi.spyOn(document, 'baseURI', 'get').mockReturnValue(baseUrl);
  vi.resetModules();
  const { platformFetch } = await import('./platformFetch');
  return {
    browserFetch,
    nativeFetch,
    fetch: platformFetch,
  };
}

describe('platformFetch', () => {
  it('rejects malformed URLs as a promise', async () => {
    const test = await setup();
    await expect(test.fetch('http://[')).rejects.toThrow(TypeError);
    expect(test.browserFetch).not.toHaveBeenCalled();
    expect(test.nativeFetch).not.toHaveBeenCalled();
  });

  it.each([
    '/app/assets/loro.wasm',
    './assets/loro.wasm',
    'tauri://localhost/app/assets/loro.wasm',
    new URL('tauri://localhost/app/assets/loro.wasm'),
    new Request('tauri://localhost/app/assets/loro.wasm'),
    'data:application/wasm;base64,AGFzbQEAAAA=',
    'blob:tauri://localhost/asset',
  ])('loads local asset %s through the webview', async (input) => {
    const test = await setup();
    await test.fetch(input);
    expect(test.browserFetch).toHaveBeenCalledWith(input);
    expect(test.nativeFetch).not.toHaveBeenCalled();
  });

  it.each([
    'http://localhost:3000/app/',
    'http://127.0.0.1:3000/app/',
    'http://[::1]:3000/app/',
    'http://tauri.localhost/app/',
  ])('keeps local HTTP assets in the webview at %s', async (baseUrl) => {
    const test = await setup(baseUrl);
    await test.fetch('./assets/loro.wasm');
    expect(test.browserFetch).toHaveBeenCalledOnce();
    expect(test.nativeFetch).not.toHaveBeenCalled();
  });

  it.each([
    'https://gateway.macro.com/dss/items',
    '//gateway.macro.com/dss/items',
    'https://gateway.macro.com/files/localhost',
    new Request('https://gateway.macro.com/dss/items'),
  ])('preserves native HTTP for remote request %s', async (input) => {
    const test = await setup('https://tauri.localhost/app/');
    const options = { signal: new AbortController().signal };
    await test.fetch(input, options);
    expect(test.nativeFetch).toHaveBeenCalledWith(input, options);
    expect(test.browserFetch).not.toHaveBeenCalled();
  });

  it('loads assets without recursion when installed as window.fetch', async () => {
    const test = await setup();
    window.fetch = test.fetch;
    await window.fetch('/app/assets/loro.wasm');
    expect(test.browserFetch).toHaveBeenCalledExactlyOnceWith(
      '/app/assets/loro.wasm'
    );
    expect(test.nativeFetch).not.toHaveBeenCalled();
  });

  it('uses native HTTP when installed as window.fetch', async () => {
    const test = await setup();
    window.fetch = test.fetch;
    await window.fetch('https://gateway.macro.com/dss/items');
    expect(test.nativeFetch).toHaveBeenCalledExactlyOnceWith(
      'https://gateway.macro.com/dss/items'
    );
    expect(test.browserFetch).not.toHaveBeenCalled();
  });

  it('preserves the current browser fetch outside Tauri', async () => {
    const test = await setup();
    mocks.isTauri.mockReturnValue(false);
    const instrumentedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response());
    window.fetch = instrumentedFetch;
    await test.fetch('/api/items');
    expect(instrumentedFetch).toHaveBeenCalledExactlyOnceWith('/api/items');
    expect(test.browserFetch).not.toHaveBeenCalled();
    expect(test.nativeFetch).not.toHaveBeenCalled();
  });
});
