// Lifetime of per-session JS code tokenizers, observed through the dev-probes registry count.
// Requires DEV_PROBES_WASM_DIR (a document_session_wasm build with --features dev-probes).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ABI_MAJOR,
  Access,
  EditorInputMsg,
  SessionConfigMsg,
  SessionInputMsg,
  Transport,
} from '@macro-inc/collaboration/session/abi.generated';
import { emptyInput } from '@macro-inc/collaboration/session/input';
import { beforeAll, expect, test } from 'vitest';
import { NativeEnterDispatcher } from '../native-enter';

const directory = process.env.DEV_PROBES_WASM_DIR;
if (!directory)
  throw new Error(
    'DEV_PROBES_WASM_DIR must name a dev-probes document_session_wasm build'
  );

type Module =
  typeof import('../../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js') & {
    debugCodeTokenProviders(): number;
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

test('a fenced provider that attempts free() mid-edit is rejected by the guard; the session then frees and the registry returns to baseline', () => {
  const before = native.debugCodeTokenProviders();
  const dispatcher = NativeEnterDispatcher.forModule(native);
  const holder: { session?: { free(): void } } = {};
  const rejected: string[] = [];
  const session = native.EditorSession.createMacroWithNamespace(
    ABI_MAJOR,
    config,
    0,
    0,
    'code-token-lifetime',
    undefined,
    undefined,
    dispatcher.fenceCodeTokenProvider(() => {
      try {
        holder.session?.free();
      } catch (error) {
        rejected.push(error instanceof Error ? error.message : String(error));
        throw error;
      }
      return JSON.stringify({ kind: 'notLoaded' });
    }),
    'native-fixture'
  );
  holder.session = session;
  expect(native.debugCodeTokenProviders()).toBe(before + 1);
  for (const kind of [0, 1]) {
    session.input(SessionInputMsg.encode(emptyInput(kind)), kind, kind);
    session.takeOutput();
  }
  session.input(
    SessionInputMsg.encode({
      ...emptyInput(2),
      editor: EditorInputMsg.fromEditorSetState({
        json: JSON.stringify({
          root: {
            type: 'root',
            version: 1,
            children: [
              {
                type: 'custom-code',
                version: 1,
                children: [{ type: 'text', version: 1, text: 'let a' }],
              },
            ],
          },
        }),
      }),
    }),
    2,
    2
  );
  session.takeOutput();
  expect(rejected).toEqual([
    'Native session receiver call during scoped callback or cleanup',
  ]);
  holder.session = undefined;
  session.free();
  expect(native.debugCodeTokenProviders()).toBe(before);
});
