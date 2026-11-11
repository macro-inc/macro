// Lifetime of per-session JS code tokenizers, observed through the dev-probes registry count.
// Requires DEV_PROBES_WASM_DIR (a document_session_wasm build with --features dev-probes).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ABI_MAJOR,
  Access,
  SessionConfigMsg,
  Transport,
} from '@macro-inc/collaboration/session/abi.generated';
import { beforeAll, expect, test } from 'vitest';

const directory = process.env.DEV_PROBES_WASM_DIR;
if (!directory)
  throw new Error(
    'DEV_PROBES_WASM_DIR must name a dev-probes document_session_wasm build'
  );

type Module = {
  initSync(options: { module: Buffer }): unknown;
  debugCodeTokenProviders(): number;
  EditorSession: {
    createMacroWithNamespace(
      abi: number,
      config: Uint8Array,
      now: number,
      wall: number,
      namespace: string,
      hostname?: string,
      writeRootSearchText?: boolean,
      provider?: (language: string, text: string, profile: string) => unknown,
      profile?: string
    ): { free(): void };
  };
};
let native: Module;

beforeAll(async () => {
  native = (await import(
    resolve(directory, 'document_session_wasm.js')
  )) as Module;
  native.initSync({
    module: readFileSync(resolve(directory, 'document_session_wasm_bg.wasm')),
  });
});

const config = SessionConfigMsg.encode({
  doc: 'code-token-lifetime',
  session: '00000000-0000-0000-0000-000000000002',
  user: 'fixture-user',
  peers: [7n, 8n, 9n],
  access: Access.Edit,
  transport: Transport.None,
  durable: false,
  chatter: false,
  headless: false,
  viewEngine: 1,
  viewOs: 0,
  token: '',
  traceparent: '',
  coalesce: 25,
  snapshotInterval: 0,
  observed: [],
});
const provider = () => JSON.stringify({ kind: 'notLoaded' });
const create = (withProvider: boolean, abi = ABI_MAJOR) =>
  native.EditorSession.createMacroWithNamespace(
    abi,
    config,
    0,
    0,
    'code-token-lifetime',
    undefined,
    undefined,
    withProvider ? provider : undefined,
    withProvider ? 'native-fixture' : undefined
  );

test('a session without a tokenizer registers nothing', () => {
  const before = native.debugCodeTokenProviders();
  const session = create(false);
  expect(native.debugCodeTokenProviders()).toBe(before);
  session.free();
});

test('a tokenizer lives exactly as long as its session', () => {
  const before = native.debugCodeTokenProviders();
  const session = create(true);
  expect(native.debugCodeTokenProviders()).toBe(before + 1);
  session.free();
  expect(native.debugCodeTokenProviders()).toBe(before);
});

test('a failed construction unregisters its tokenizer', () => {
  const before = native.debugCodeTokenProviders();
  expect(() => create(true, ABI_MAJOR + 1)).toThrow();
  expect(native.debugCodeTokenProviders()).toBe(before);
});

test('sessions own separate registrations', () => {
  const before = native.debugCodeTokenProviders();
  const first = create(true);
  const second = create(true);
  expect(native.debugCodeTokenProviders()).toBe(before + 2);
  first.free();
  expect(native.debugCodeTokenProviders()).toBe(before + 1);
  second.free();
  expect(native.debugCodeTokenProviders()).toBe(before);
});
