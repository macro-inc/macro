import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('compiled design engine', () => {
  it('shares one fetch and compilation across concurrent and later opens', async () => {
    const module = {} as WebAssembly.Module;
    const fetch = vi.fn().mockResolvedValue(
      new Response('', {
        headers: { 'content-type': 'application/wasm' },
      })
    );
    vi.stubGlobal('fetch', fetch);
    const compile = vi
      .spyOn(WebAssembly, 'compileStreaming')
      .mockResolvedValue(module);
    const { compiledFigModule } = await import('./compiled-module');
    const [a, b] = await Promise.all([
      compiledFigModule(),
      compiledFigModule(),
    ]);
    expect(a).toBe(module);
    expect(b).toBe(module);
    expect(await compiledFigModule()).toBe(module);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(compile).toHaveBeenCalledTimes(1);
  });

  it('retries after failure and supports hosts without a wasm MIME type', async () => {
    const module = {} as WebAssembly.Module;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([0, 97, 115, 109])));
    vi.stubGlobal('fetch', fetch);
    const compile = vi.spyOn(WebAssembly, 'compile').mockResolvedValue(module);
    const { compiledFigModule } = await import('./compiled-module');
    await expect(compiledFigModule()).rejects.toThrow('503');
    expect(await compiledFigModule()).toBe(module);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(compile).toHaveBeenCalledTimes(1);
  });
});
