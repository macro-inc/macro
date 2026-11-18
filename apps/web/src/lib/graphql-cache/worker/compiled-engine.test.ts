import { afterEach, expect, it, vi } from 'vitest';
import {
  compiledEngineFromPage,
  forgetCompiledEngine,
  offerCompiledEngine,
} from './compiled-engine';

// The smallest valid module: magic number and version.
const EMPTY_WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0, 0, 0]);

const channels: MessageChannel[] = [];
function engineStart() {
  const channel = new MessageChannel();
  channels.push(channel);
  const worker = compiledEngineFromPage(channel.port2);
  offerCompiledEngine(channel.port1);
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
