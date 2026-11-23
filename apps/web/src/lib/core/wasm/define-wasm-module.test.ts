import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineWasmModule, type WasmLoadPhase } from './define-wasm-module';

/** The smallest valid binary: the magic number and version 1. */
const EMPTY_MODULE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('defineWasmModule', () => {
  it('shares one instance, retries a failed load, and starts a fresh copy of the glue after discard', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(
        async () =>
          new Response(EMPTY_MODULE, {
            headers: { 'content-type': 'application/wasm' },
          })
      );
    vi.stubGlobal('fetch', fetch);
    const instances: Array<{ module_or_path: WebAssembly.Module }> = [];
    const memory = new WebAssembly.Memory({ initial: 1 });
    const module = defineWasmModule({
      name: 'example',
      thread: 'main',
      checkThread: true,
      binaryUrl: '/assets/example_bg-1.wasm',
      glue: async () => ({
        instantiateGlue: () => ({
          default: async (input: { module_or_path: WebAssembly.Module }) => {
            instances.push(input);
            return { memory };
          },
        }),
      }),
    });

    const failed = module.load();
    expect(module.load()).toBe(failed);
    await expect(failed).rejects.toThrow('offline');
    expect(module.memory()).toBeUndefined();

    const loaded = module.load();
    expect(loaded).not.toBe(failed);
    const glue = await loaded;
    expect(module.load()).toBe(loaded);
    expect(instances).toHaveLength(1);
    expect(instances[0]?.module_or_path).toBeInstanceOf(WebAssembly.Module);
    expect(module.memory()).toBe(memory);

    module.discard();
    expect(module.memory()).toBeUndefined();
    const fresh = await module.load();
    expect(fresh).not.toBe(glue);
    expect(instances).toHaveLength(2);
    // The compiled binary outlives the trapped instance.
    expect(instances[1]?.module_or_path).toBe(instances[0]?.module_or_path);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('compiles the fetched response itself when it is served as application/wasm', async () => {
    const response = new Response(EMPTY_MODULE, {
      headers: { 'content-type': 'application/wasm' },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response)
    );
    const streaming = vi.spyOn(WebAssembly, 'compileStreaming');
    const phases: WasmLoadPhase[] = [];
    const module = defineWasmModule({
      name: 'example',
      thread: 'worker',
      checkThread: true,
      binaryUrl: '/assets/example_bg-1.wasm',
      glue: async () => {
        throw new Error('not loaded');
      },
    });

    const compiled = await module.compiled({
      onPhase: (phase) => phases.push(phase),
    });

    expect(compiled).toBeInstanceOf(WebAssembly.Module);
    expect(await module.compiled()).toBe(compiled);
    // Chromium caches compiled code only for the response it fetched.
    expect(streaming).toHaveBeenCalledExactlyOnceWith(response);
    expect(
      phases.map(({ phase, outcome, bytes }) => ({ phase, outcome, bytes }))
    ).toEqual([
      { phase: 'download', outcome: 'success', bytes: undefined },
      { phase: 'compile', outcome: 'success', bytes: undefined },
    ]);
  });

  it('compiles from bytes once when the stream fails for another reason, and keeps no compile from compile()', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(EMPTY_MODULE, {
          headers: { 'content-type': 'application/wasm' },
        })
    );
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(WebAssembly, 'compileStreaming').mockRejectedValueOnce(
      new TypeError('network error')
    );
    const phases: WasmLoadPhase[] = [];
    const module = defineWasmModule({
      name: 'example',
      thread: 'worker',
      checkThread: true,
      binaryUrl: '/assets/example_bg-1.wasm',
      glue: async () => {
        throw new Error('not loaded');
      },
    });

    const first = await module.compile({
      onPhase: (phase) => phases.push(phase),
    });

    expect(first).toBeInstanceOf(WebAssembly.Module);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      phases.map(({ phase, outcome, bytes }) => ({ phase, outcome, bytes }))
    ).toEqual([
      { phase: 'download', outcome: 'success', bytes: undefined },
      { phase: 'download', outcome: 'error', bytes: undefined },
      { phase: 'download', outcome: 'success', bytes: 8 },
      { phase: 'compile', outcome: 'success', bytes: undefined },
    ]);
    expect(await module.compile()).not.toBe(first);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('reports a streamed binary that does not compile, without a second download', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'content-type': 'application/wasm' },
        })
    );
    vi.stubGlobal('fetch', fetch);
    const phases: WasmLoadPhase[] = [];
    const module = defineWasmModule({
      name: 'example',
      thread: 'worker',
      checkThread: true,
      binaryUrl: '/assets/example_bg-1.wasm',
      glue: async () => {
        throw new Error('not loaded');
      },
    });

    await expect(
      module.compiled({ onPhase: (phase) => phases.push(phase) })
    ).rejects.toBeInstanceOf(WebAssembly.CompileError);
    expect(fetch).toHaveBeenCalledOnce();
    expect(phases.map(({ phase, outcome }) => ({ phase, outcome }))).toEqual([
      { phase: 'download', outcome: 'success' },
      { phase: 'compile', outcome: 'error' },
    ]);
  });

  it('compiles from bytes when the binary is not served as application/wasm, and retries a failed download', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('', { status: 503 }))
        .mockResolvedValue(
          new Response(EMPTY_MODULE, {
            // A parameter rules out streaming too.
            headers: { 'content-type': 'application/wasm; charset=binary' },
          })
        )
    );
    const streaming = vi.spyOn(WebAssembly, 'compileStreaming');
    const module = defineWasmModule({
      name: 'example',
      thread: 'worker',
      checkThread: true,
      binaryUrl: '/assets/example_bg-1.wasm',
      glue: async () => {
        throw new Error('not loaded');
      },
    });

    await expect(module.compiled()).rejects.toThrow(
      'example wasm download returned HTTP 503'
    );
    expect(await module.compiled()).toBeInstanceOf(WebAssembly.Module);
    expect(streaming).not.toHaveBeenCalled();
  });

  it('refuses to start a worker module outside a worker, but compiles it for one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(EMPTY_MODULE, {
            headers: { 'content-type': 'application/wasm' },
          })
      )
    );
    const module = defineWasmModule({
      name: 'example',
      thread: 'worker',
      checkThread: true,
      binaryUrl: '/assets/example_bg-1.wasm',
      glue: async () => {
        throw new Error('not loaded');
      },
    });

    await expect(module.load()).rejects.toThrow('example runs in a worker');
    expect(await module.compiled()).toBeInstanceOf(WebAssembly.Module);
  });
});
