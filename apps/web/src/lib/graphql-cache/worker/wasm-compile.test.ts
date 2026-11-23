// @vitest-environment node
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { compileCacheWasm } from './wasm-compile';

// The smallest valid module: the magic number and version 1.
const EMPTY_MODULE = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0, 0, 0]);
const url = new URL('https://app.example/assets/cache_wasm_bg-abc.wasm');

function serve(response: Response | (() => Response)) {
  const fetch = vi.fn(async () =>
    typeof response === 'function' ? response() : response
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function clock() {
  let time = 0;
  return () => (time += 10);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('compileCacheWasm', () => {
  it('compiles a response labelled as WASM from its stream', async () => {
    const fetch = serve(
      new Response(EMPTY_MODULE, {
        headers: { 'content-type': 'application/wasm' },
      })
    );
    const compileStreaming = vi.spyOn(WebAssembly, 'compileStreaming');
    const compile = vi.spyOn(WebAssembly, 'compile');
    const record = vi.fn();

    const compiled = await compileCacheWasm(url, { record }, clock());

    expect(compiled).toBeInstanceOf(WebAssembly.Module);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(url);
    expect(compileStreaming).toHaveBeenCalledOnce();
    expect(compile).not.toHaveBeenCalled();
    expect(record.mock.calls.map(([event]) => event)).toEqual([
      {
        name: 'graphql_cache.wasm_download',
        operationCategory: 'initialization',
        outcome: 'success',
        errorCode: 'none',
        durationMs: 10,
      },
      {
        name: 'graphql_cache.wasm_compile',
        operationCategory: 'initialization',
        outcome: 'success',
        errorCode: 'none',
        durationMs: 10,
      },
    ]);
  });

  it.each(['application/octet-stream', 'application/wasm; charset=binary'])(
    'compiles from bytes for content type %s',
    async (contentType) => {
      serve(
        new Response(EMPTY_MODULE, {
          headers: { 'content-type': contentType },
        })
      );
      const compileStreaming = vi.spyOn(WebAssembly, 'compileStreaming');
      const record = vi.fn();

      const compiled = await compileCacheWasm(url, { record }, clock());

      expect(compiled).toBeInstanceOf(WebAssembly.Module);
      expect(compileStreaming).not.toHaveBeenCalled();
      expect(record).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          name: 'graphql_cache.wasm_download',
          outcome: 'success',
          bytes: EMPTY_MODULE.byteLength,
        })
      );
      expect(record).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          name: 'graphql_cache.wasm_compile',
          outcome: 'success',
        })
      );
    }
  );

  it('compiles from bytes where streaming compilation is missing', async () => {
    serve(
      new Response(EMPTY_MODULE, {
        headers: { 'content-type': 'application/wasm' },
      })
    );
    const streaming = Object.getOwnPropertyDescriptor(
      WebAssembly,
      'compileStreaming'
    );
    Object.defineProperty(WebAssembly, 'compileStreaming', {
      value: undefined,
      configurable: true,
    });
    onTestFinished(() => {
      if (streaming) {
        Object.defineProperty(WebAssembly, 'compileStreaming', streaming);
      }
    });
    const compile = vi.spyOn(WebAssembly, 'compile');
    const record = vi.fn();

    await expect(
      compileCacheWasm(url, { record }, clock())
    ).resolves.toBeInstanceOf(WebAssembly.Module);
    expect(compile).toHaveBeenCalledOnce();
    expect(record).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ bytes: EMPTY_MODULE.byteLength })
    );
  });

  it('reports a failed download and compiles nothing', async () => {
    serve(new Response('missing', { status: 404 }));
    const compileStreaming = vi.spyOn(WebAssembly, 'compileStreaming');
    const record = vi.fn();

    await expect(compileCacheWasm(url, { record }, clock())).rejects.toThrow(
      'cache WASM download returned HTTP 404'
    );
    expect(compileStreaming).not.toHaveBeenCalled();
    expect(record.mock.calls.map(([event]) => event)).toEqual([
      expect.objectContaining({
        name: 'graphql_cache.wasm_download',
        outcome: 'error',
        errorCode: 'wasm-download',
      }),
    ]);
  });

  it('compiles from bytes once when the stream fails for another reason', async () => {
    const fetch = serve(
      () =>
        new Response(EMPTY_MODULE, {
          headers: { 'content-type': 'application/wasm' },
        })
    );
    const compileStreaming = vi
      .spyOn(WebAssembly, 'compileStreaming')
      .mockRejectedValueOnce(new TypeError('network error'));
    const record = vi.fn();

    const compiled = await compileCacheWasm(url, { record }, clock());

    expect(compiled).toBeInstanceOf(WebAssembly.Module);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(compileStreaming).toHaveBeenCalledOnce();
    expect(record.mock.calls.map(([event]) => event)).toEqual([
      expect.objectContaining({
        name: 'graphql_cache.wasm_download',
        outcome: 'success',
      }),
      expect.objectContaining({
        name: 'graphql_cache.wasm_download',
        outcome: 'error',
        errorCode: 'wasm-download',
      }),
      expect.objectContaining({
        name: 'graphql_cache.wasm_download',
        outcome: 'success',
        bytes: EMPTY_MODULE.byteLength,
      }),
      expect.objectContaining({
        name: 'graphql_cache.wasm_compile',
        outcome: 'success',
      }),
    ]);
  });

  it('reports a streamed binary that does not compile', async () => {
    const fetch = serve(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'content-type': 'application/wasm' },
      })
    );
    const record = vi.fn();

    await expect(
      compileCacheWasm(url, { record }, clock())
    ).rejects.toBeInstanceOf(WebAssembly.CompileError);
    expect(record.mock.calls.map(([event]) => event)).toEqual([
      expect.objectContaining({
        name: 'graphql_cache.wasm_download',
        outcome: 'success',
      }),
      expect.objectContaining({
        name: 'graphql_cache.wasm_compile',
        outcome: 'error',
        errorCode: 'wasm-compile',
      }),
    ]);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
