import { describe, expect, it, vi } from 'vitest';
import { createTauriFetch } from './createTauriFetch';

function setup(baseUrl = 'tauri://localhost/app/index.html') {
  const browserFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response());
  const nativeFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response());
  return {
    browserFetch,
    nativeFetch,
    fetch: createTauriFetch(browserFetch, nativeFetch, () => baseUrl),
  };
}

describe('Tauri fetch routing', () => {
  it('rejects malformed URLs as a promise', async () => {
    const test = setup();
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
    const test = setup();
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
    const test = setup(baseUrl);
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
    const test = setup('https://tauri.localhost/app/');
    const options = { signal: new AbortController().signal };
    await test.fetch(input, options);
    expect(test.nativeFetch).toHaveBeenCalledWith(input, options);
    expect(test.browserFetch).not.toHaveBeenCalled();
  });
});
