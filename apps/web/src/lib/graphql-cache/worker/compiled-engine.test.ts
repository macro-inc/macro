import { afterEach, expect, it, vi } from 'vitest';
import {
  type CompiledEngine,
  compiledEngineFromPage,
  dropPrefetchedCompiledEngine,
  forgetCompiledEngine,
  offerCompiledEngine,
  prefetchCompiledEngine,
} from './compiled-engine';

// The smallest valid module: magic number and version.
const EMPTY_WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0, 0, 0]);

const channels: MessageChannel[] = [];
function engineStart(waitMs?: number) {
  const channel = new MessageChannel();
  channels.push(channel);
  const worker = compiledEngineFromPage(channel.port2);
  offerCompiledEngine(channel.port1, waitMs);
  return worker;
}

afterEach(() => {
  for (const channel of channels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
  forgetCompiledEngine();
});

it('gives the next engine worker the module an earlier one compiled', async () => {
  const first = engineStart();
  await expect(first.offered).resolves.toBeUndefined();

  const module = await WebAssembly.compile(EMPTY_WASM);
  first.report({ assetUrl: 'https://app.test/engine-a.wasm', module });

  // The page keeps it once the report has been delivered.
  await vi.waitFor(async () => {
    const next = await engineStart().offered;
    expect(next?.assetUrl).toBe('https://app.test/engine-a.wasm');
    expect(next?.module).toBeInstanceOf(WebAssembly.Module);
  });
});

it('stops offering a module the worker said it could not receive', async () => {
  const first = engineStart();
  first.report({
    assetUrl: 'https://app.test/engine-a.wasm',
    module: await WebAssembly.compile(EMPTY_WASM),
  });
  await vi.waitFor(async () => {
    expect(await engineStart().offered).toBeDefined();
  });

  const channel = new MessageChannel();
  channels.push(channel);
  offerCompiledEngine(channel.port1);
  channel.port2.postMessage(null);

  await vi.waitFor(async () => {
    expect(await engineStart().offered).toBeUndefined();
  });
});

it('offers nothing when what arrives is not a compiled engine', async () => {
  const channel = new MessageChannel();
  channels.push(channel);
  const worker = compiledEngineFromPage(channel.port2);
  channel.port1.postMessage({ assetUrl: 'https://app.test/engine-a.wasm' });

  await expect(worker.offered).resolves.toBeUndefined();
});

async function compiledAhead(): Promise<CompiledEngine> {
  return {
    assetUrl: 'https://app.test/engine-a.wasm',
    module: await WebAssembly.compile(EMPTY_WASM),
  };
}

it('gives the first engine worker the module the page compiled ahead of it', async () => {
  let finish: (engine: CompiledEngine) => void = () => undefined;
  prefetchCompiledEngine(
    () => new Promise<CompiledEngine>((resolve) => (finish = resolve))
  );
  // The worker starts before the compile ends and waits for it.
  const worker = engineStart();
  let offered: CompiledEngine | undefined | 'pending' = 'pending';
  worker.offered.then((engine) => (offered = engine)).catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(offered).toBe('pending');

  finish(await compiledAhead());
  const engine = await worker.offered;
  expect(engine?.assetUrl).toBe('https://app.test/engine-a.wasm');
  expect(engine?.module).toBeInstanceOf(WebAssembly.Module);
});

it('leaves the compile to the worker when the one ahead failed', async () => {
  prefetchCompiledEngine(() => Promise.reject(new Error('download failed')));
  await expect(engineStart().offered).resolves.toBeUndefined();
});

it('keeps a compile ahead for the worker that starts when the tab returns', async () => {
  prefetchCompiledEngine(compiledAhead);
  await expect(engineStart().offered).resolves.toBeDefined();
  // The first worker started from it and reported nothing back.
  const next = await engineStart().offered;
  expect(next?.assetUrl).toBe('https://app.test/engine-a.wasm');
  expect(next?.module).toBeInstanceOf(WebAssembly.Module);
});

it('stops offering a compile ahead the worker could not receive', async () => {
  prefetchCompiledEngine(compiledAhead);
  const channel = new MessageChannel();
  channels.push(channel);
  // A worker answers `null` only after the offer reached it.
  const delivered = new Promise<unknown>((resolve) => {
    channel.port2.onmessage = (event) => resolve(event.data);
  });
  offerCompiledEngine(channel.port1);
  await expect(delivered).resolves.toBeDefined();
  channel.port2.postMessage(null);

  await vi.waitFor(async () => {
    expect(await engineStart().offered).toBeUndefined();
  });
});

it('forgets a compile ahead once another page runs the engine', async () => {
  prefetchCompiledEngine(compiledAhead);
  dropPrefetchedCompiledEngine();
  await expect(engineStart().offered).resolves.toBeUndefined();
});

it('compiles nothing ahead when the page holds a module or a compile', async () => {
  const first = engineStart();
  first.report(await compiledAhead());
  await vi.waitFor(async () => {
    expect(await engineStart().offered).toBeDefined();
  });
  const compile = vi.fn(compiledAhead);
  prefetchCompiledEngine(compile);
  expect(compile).not.toHaveBeenCalled();

  forgetCompiledEngine();
  prefetchCompiledEngine(compile);
  prefetchCompiledEngine(compile);
  expect(compile).toHaveBeenCalledTimes(1);
});

it('lets the worker compile when the compile ahead stalls, and keeps it if it finishes', async () => {
  let finish: (engine: CompiledEngine) => void = () => undefined;
  prefetchCompiledEngine(
    () => new Promise<CompiledEngine>((resolve) => (finish = resolve))
  );
  await expect(engineStart(20).offered).resolves.toBeUndefined();

  finish(await compiledAhead());
  await vi.waitFor(async () => {
    const next = await engineStart().offered;
    expect(next?.assetUrl).toBe('https://app.test/engine-a.wasm');
  });
});

it('keeps the module a later report retained over a stalled compile ahead', async () => {
  let finish: (engine: CompiledEngine) => void = () => undefined;
  prefetchCompiledEngine(
    () => new Promise<CompiledEngine>((resolve) => (finish = resolve))
  );
  const first = engineStart(20);
  await expect(first.offered).resolves.toBeUndefined();
  first.report({
    assetUrl: 'https://app.test/engine-b.wasm',
    module: await WebAssembly.compile(EMPTY_WASM),
  });
  await vi.waitFor(async () => {
    expect((await engineStart().offered)?.assetUrl).toBe(
      'https://app.test/engine-b.wasm'
    );
  });

  finish(await compiledAhead());
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect((await engineStart().offered)?.assetUrl).toBe(
    'https://app.test/engine-b.wasm'
  );
});

it('stops waiting for the page after its deadline even when the page never answers', async () => {
  const channel = new MessageChannel();
  channels.push(channel);
  // No offerCompiledEngine: a page whose main thread is held never posts.
  await expect(
    compiledEngineFromPage(channel.port2, 20).offered
  ).resolves.toBeUndefined();
});

it('does not answer an offer that arrives after the deadline, so its report stays', async () => {
  const channel = new MessageChannel();
  channels.push(channel);
  const received: unknown[] = [];
  channel.port1.onmessage = (event) => received.push(event.data);
  const worker = compiledEngineFromPage(channel.port2, 20);
  await expect(worker.offered).resolves.toBeUndefined();
  worker.report({
    assetUrl: 'https://app.test/engine-b.wasm',
    module: await WebAssembly.compile(EMPTY_WASM),
  });
  // A late offer the worker cannot receive.
  channel.port2.onmessageerror?.(new MessageEvent('messageerror'));
  await vi.waitFor(() => expect(received).toHaveLength(1));
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(received).toHaveLength(1);
  expect(received[0]).not.toBeNull();
});

it('does not keep a compile ahead that finishes after the page dropped it', async () => {
  let finish: (engine: CompiledEngine) => void = () => undefined;
  prefetchCompiledEngine(
    () =>
      new Promise<CompiledEngine>((resolve) => {
        finish = resolve;
      })
  );
  // The worker took the pending compile, then the page left the coordinator.
  const first = engineStart();
  dropPrefetchedCompiledEngine();
  finish({
    assetUrl: 'https://app.test/engine-a.wasm',
    module: await WebAssembly.compile(EMPTY_WASM),
  });
  await expect(first.offered).resolves.toBeDefined();
  await expect(engineStart().offered).resolves.toBeUndefined();
});

it('leaves the compile to the worker when the compile ahead cannot start', async () => {
  expect(() =>
    prefetchCompiledEngine(() => {
      throw new Error('no compile');
    })
  ).not.toThrow();
  await expect(engineStart().offered).resolves.toBeUndefined();
});
