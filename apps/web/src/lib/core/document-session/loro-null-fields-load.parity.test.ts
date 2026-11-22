/** @vitest-environment jsdom */
/**
 * A Loro document a Source client wrote from JSON-imported nodes stores every
 * omitted optional field as null: state.toJSON() keeps their keys with
 * undefined values and the mirror writer stores undefined as null. Source opens
 * it through initializeEditorWithVersionedState; TextNode.updateFromJSON's
 * setMode(null) stores undefined, so the text exports no mode (Lexical 0.45.0
 * dist/Lexical.dev.mjs sha256 449d061d). Native loads the same bytes through
 * the ordinary Seed input (seeded-session.test-fixture) and must open it with
 * mode omitted too.
 *
 * Scope: slice (A), the load and mode. The other null fields (text
 * format/detail/style, paragraph textFormat/textStyle and the indent DOM) are
 * slice (B) and are not asserted against native here.
 */
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import { theme } from '@core/component/LexicalMarkdown/theme';
import {
  initializeEditorWithVersionedState,
  loroSyncState,
} from '@core/component/LexicalMarkdown/utils';
import * as native from '@core/document-session/wasm/document_session_wasm.js';
import { registerRichText } from '@lexical/rich-text';
import {
  createLoroManager,
  type LoroManager,
} from '@macro-inc/collaboration/collab/manager';
import { NodeReplacements, SupportedNodeTypes } from '@macro-inc/lexical-core';
import { MARKDOWN_LORO_SCHEMA } from '@macro-inc/lexical-core/markdown-loro-schema';
import { createEditor, type SerializedEditorState } from 'lexical';
import { LoroDoc } from 'loro-crdt';
import { createRoot } from 'solid-js';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import {
  mountSeededSession,
  ReleaseFailures,
  SEED_CODE,
  type SeededSessionRelease,
  type SeedOrigin,
  SetupFailure,
} from './seeded-session.test-fixture';

// The editor utilities pull in the plugin barrel, whose leaves open the
// storage and connection-gateway sockets on import (as listToTableUndo.test).
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

let previousLocks: PropertyDescriptor | undefined;
beforeAll(() => {
  previousLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: locks,
  });
  native.initSync({
    module: readFileSync(
      resolve(import.meta.dirname, 'wasm/document_session_wasm_bg.wasm')
    ),
  });
});
afterAll(() => {
  if (previousLocks) Object.defineProperty(navigator, 'locks', previousLocks);
  else Reflect.deleteProperty(navigator, 'locks');
});
const cleanups: Array<() => unknown> = [];
/** Every release runs; one raw failure is rethrown as-is, several all together. */
afterEach(async () => {
  const failures: unknown[] = [];
  for (const cleanup of cleanups.splice(0).reverse()) {
    try {
      await cleanup();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new ReleaseFailures(failures);
});

const paragraph = (children: Record<string, unknown>[]) =>
  JSON.stringify({
    root: {
      type: 'root',
      version: 1,
      children: [{ type: 'paragraph', version: 1, children }],
    },
  });
/** Text and a chip with every optional field omitted, as a JSON import leaves them. */
const IMPORTED = paragraph([
  { type: 'text', version: 1, text: 'hi ' },
  { type: 'inline-search', version: 1, text: '/' },
]);
/** The same text with every field present: no nulls reach Loro. */
const COMPLETE = paragraph([
  {
    type: 'text',
    version: 1,
    text: 'hi ',
    detail: 0,
    format: 0,
    mode: 'normal',
    style: '',
  },
]);

/**
 * A Loro manager owned by this test. createLoroManager registers
 * onCleanup(dispose) on its Solid owner, so disposing the root frees the
 * manager and its doc exactly once.
 */
function ownedManager(documentId: string): LoroManager {
  let manager: LoroManager | undefined;
  const dispose = createRoot((disposeRoot) => {
    manager = createLoroManager(MARKDOWN_LORO_SCHEMA, { documentId });
    return disposeRoot;
  });
  cleanups.push(dispose);
  if (!manager) throw new Error('Missing Loro manager');
  return manager;
}
function emptySnapshot() {
  const doc = new LoroDoc();
  try {
    return doc.export({ mode: 'snapshot' });
  } finally {
    doc.free();
  }
}

/** The app's Source writer, as CollabProvider writes (writeStateToLoro({ ...state })). */
async function sourceWrittenSnapshot(json: string) {
  const editor = createEditor({
    namespace: 'loro-null-fields-writer',
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
    onError(error) {
      throw error;
    },
  });
  const writer = ownedManager('loro-null-fields-writer');
  await writer.initializeFromSnapshot(emptySnapshot());
  await writer.syncToLoro({ ...loroSyncState(editor.parseEditorState(json)) });
  return writer.doc.export({ mode: 'snapshot' });
}

/** The mirror's state is the app's serialized state; check its root shape. */
function isSerializedEditorState(
  value: unknown
): value is SerializedEditorState {
  if (!value || typeof value !== 'object' || !('root' in value)) return false;
  const root = value.root;
  return (
    !!root &&
    typeof root === 'object' &&
    'type' in root &&
    root.type === 'root' &&
    'children' in root &&
    Array.isArray(root.children)
  );
}

function textsOf(state: unknown): unknown[] {
  if (!state || typeof state !== 'object' || !('root' in state)) return [];
  const root = state.root;
  if (!root || typeof root !== 'object' || !('children' in root)) return [];
  const [first] = Array.isArray(root.children) ? root.children : [];
  return first &&
    typeof first === 'object' &&
    'children' in first &&
    Array.isArray(first.children)
    ? first.children
    : [];
}

test("the seed codes match native's decoder (machine.rs SessionInputMsg kind 1)", () => {
  const machine = readFileSync(
    resolve(
      import.meta.dirname,
      '../../../../../../crates/client/document_session_wasm/src/machine.rs'
    ),
    'utf8'
  );
  const decoder = machine.match(
    /1 => SessionInput::Sync\(SyncInput::Seed \{\s*kind: match msg\.code \{([^}]*)\}/
  )?.[1];
  expect(decoder?.replace(/\s+/g, ' ').trim()).toBe(
    `${SEED_CODE.optimistic} => SeedKind::Optimistic, ${SEED_CODE['cached-s3']} => SeedKind::CachedS3, _ => return Err(BoundaryError::Invalid("seed")),`
  );
});

test('the Source writer stores the omitted fields as null', async () => {
  const doc = new LoroDoc();
  cleanups.push(() => doc.free());
  doc.import(await sourceWrittenSnapshot(IMPORTED));
  expect(doc.toJSON().root).toMatchObject({
    children: [
      {
        children: [
          { text: 'hi ', mode: null, format: null, detail: null, style: null },
          { text: '/', mode: null, format: null, detail: null, style: null },
        ],
      },
    ],
  });
});

test('Source opens the null-field document and exports no mode (the oracle)', async () => {
  const snapshot = await sourceWrittenSnapshot(IMPORTED);
  const reader = ownedManager('loro-null-fields-reader');
  await reader.initializeFromSnapshot(snapshot);
  const loaded = reader.state?.state;
  const editor = createEditor({
    namespace: 'loro-null-fields-reader',
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
    theme,
    onError(error) {
      throw error;
    },
  });
  const root = document.createElement('div');
  document.body.append(root);
  cleanups.push(() => root.remove());
  root.contentEditable = 'true';
  editor.setRootElement(root);
  cleanups.push(() => editor.setRootElement(null));
  cleanups.push(registerRichText(editor));
  // The real app load (CollabProvider -> initializeEditorWithVersionedState).
  const mirror: unknown = loaded;
  if (!isSerializedEditorState(mirror)) throw new Error('Missing loaded state');
  expect(textsOf(mirror)).toMatchObject([{ mode: null }, { mode: null }]);
  expect(
    initializeEditorWithVersionedState(editor, mirror, () => 'peer-own')
  ).toBeNull();
  // The serialized state (what Source stores and compares): undefined keys drop.
  const texts = textsOf(
    JSON.parse(JSON.stringify(editor.getEditorState().toJSON()))
  );
  expect(texts).toMatchObject([
    { text: 'hi ', type: 'text' },
    { text: '/', type: 'inline-search' },
  ]);
  for (const text of texts) expect(text).not.toHaveProperty('mode');
});

test('a native session with no seed opens an empty document (the default)', async () => {
  const session = await mountSeededSession(undefined);
  cleanups.push(() => session.close());
  expect(session.errors).toEqual([]);
  expect(session.root.textContent).toBe('');
});

const ORIGINS: readonly SeedOrigin[] = ['optimistic', 'cached-s3'];
for (const origin of ORIGINS) {
  test(`native opens a complete Source-written document seeded as ${origin}`, async () => {
    const session = await mountSeededSession({
      origin,
      snapshot: await sourceWrittenSnapshot(COMPLETE),
    });
    cleanups.push(() => session.close());
    expect(session.errors).toEqual([]);
    expect(session.root.textContent).toBe('hi ');
  });
}

test('a malformed snapshot never initializes the view, and the session still releases', async () => {
  // Observed: the import fails inside the sync core (no onError), so no
  // Initialize arrives: no key generation and nothing rendered.
  const session = await mountSeededSession({
    origin: 'cached-s3',
    snapshot: new Uint8Array([1, 2, 3, 4]),
  });
  cleanups.push(() => session.close());
  expect(session.errors).toEqual([]);
  expect(session.view.mirror.keyGeneration).toBeNull();
  expect(session.root.childElementCount).toBe(0);
  await session.close();
  expect(session.root.isConnected).toBe(false);
});

// RED, owned by slice (B). Native still cannot open a Source-written null-field
// document. Before (A) the import failed at parse ('JSON error: invalid type:
// null, expected string or map', text mode null). With (A) it gets past parse
// and fails at attach ('projection diverged: attach synced JSON differs').
// Suspected, not yet verified: native coerces null format/detail/style and
// paragraph textFormat/textStyle to ''/0 where the Loro document holds null.
// (B) keeps them null as Source does.
test('native opens the Source-written null-field document through the real seed load', async () => {
  const session = await mountSeededSession({
    origin: 'cached-s3',
    snapshot: await sourceWrittenSnapshot(IMPORTED),
  });
  cleanups.push(() => session.close());
  expect(session.errors.map(String)).toEqual([]);
  const texts = textsOf(JSON.parse(session.view.query.serializedState()));
  expect(texts).toMatchObject([
    { text: 'hi ', type: 'text' },
    { text: '/', type: 'inline-search' },
  ]);
  // Source exports no mode for a null mode (the oracle above).
  for (const text of texts) expect(text).not.toHaveProperty('mode');
  expect(session.root.textContent).toBe('hi /');
});

// ---- Fixture lifetime controls ---------------------------------------------
// Each control records the real releases and checks they completed before the
// promise under test settled, so a fault hook can never stand in for teardown.

function recorder() {
  const released: SeededSessionRelease[] = [];
  return {
    released,
    record: (release: SeededSessionRelease) => released.push(release),
  };
}
type Settled =
  | { readonly ok: true; readonly value: unknown; readonly released: string[] }
  | {
      readonly ok: false;
      readonly error: unknown;
      readonly released: string[];
    };
/** Settle `promise`, snapshotting the real releases witnessed by then. */
async function settled(
  promise: Promise<unknown>,
  released: readonly string[]
): Promise<Settled> {
  return promise.then(
    (value: unknown): Settled => ({ ok: true, value, released: [...released] }),
    (error: unknown): Settled => ({ ok: false, error, released: [...released] })
  );
}

test('a setup failure joins the real teardown and rejects with the raw primary', async () => {
  const primary = new Error('setup primary');
  const { released, record } = recorder();
  let root: HTMLElement | undefined;
  const outcome = await settled(
    mountSeededSession(undefined, {
      released: record,
      afterMount(mounted) {
        root = mounted;
        throw primary;
      },
    }),
    released
  );
  expect(outcome).toEqual({
    ok: false,
    error: primary,
    released: ['session.free', 'telemetry.close'],
  });
  expect(root?.isConnected).toBe(false);
});

test('an undefined setup primary is kept as-is after the real teardown', async () => {
  const { released, record } = recorder();
  const outcome = await settled(
    mountSeededSession(undefined, {
      released: record,
      afterMount() {
        throw undefined;
      },
    }),
    released
  );
  expect(outcome).toEqual({
    ok: false,
    error: undefined,
    released: ['session.free', 'telemetry.close'],
  });
});

test('a setup failure whose teardown faults still runs every real release and keeps all failures', async () => {
  const primary = new Error('setup primary');
  const session = new Error('session release');
  const { released, record } = recorder();
  let root: HTMLElement | undefined;
  const outcome = await settled(
    mountSeededSession(undefined, {
      released: record,
      afterMount(mounted) {
        root = mounted;
        throw primary;
      },
      afterSessionClose() {
        throw session;
      },
      afterTelemetryClose() {
        throw null;
      },
    }),
    released
  );
  expect(outcome.released).toEqual(['session.free', 'telemetry.close']);
  const failure = outcome.ok ? undefined : outcome.error;
  expect(failure).toBeInstanceOf(SetupFailure);
  expect(failure instanceof SetupFailure && failure.primary).toBe(primary);
  expect(failure instanceof SetupFailure && failure.releaseFailures).toEqual([
    session,
    null,
  ]);
  expect(root?.isConnected).toBe(false);
});

test('close with two faults still runs every real release, keeps each raw failure and removes the root', async () => {
  const session = new Error('session release');
  const { released, record } = recorder();
  const mounted = await mountSeededSession(undefined, {
    released: record,
    afterSessionClose() {
      throw session;
    },
    afterTelemetryClose() {
      throw undefined;
    },
  });
  expect(released).toEqual([]);
  const outcome = await settled(mounted.close(), released);
  expect(outcome.released).toEqual(['session.free', 'telemetry.close']);
  const failure = outcome.ok ? undefined : outcome.error;
  expect(failure).toBeInstanceOf(ReleaseFailures);
  expect(failure instanceof ReleaseFailures && failure.failures).toEqual([
    session,
    undefined,
  ]);
  expect(mounted.root.isConnected).toBe(false);
});

test('a single null release fault is rethrown raw after every real release', async () => {
  const { released, record } = recorder();
  const mounted = await mountSeededSession(undefined, {
    released: record,
    afterTelemetryClose() {
      throw null;
    },
  });
  const outcome = await settled(mounted.close(), released);
  expect(outcome).toEqual({
    ok: false,
    error: null,
    released: ['session.free', 'telemetry.close'],
  });
  expect(mounted.root.isConnected).toBe(false);
});

test('a clean close runs each real release once', async () => {
  const { released, record } = recorder();
  const mounted = await mountSeededSession(undefined, { released: record });
  const first = mounted.close();
  expect(mounted.close()).toBe(first);
  await first;
  expect(released).toEqual(['session.free', 'telemetry.close']);
  expect(mounted.root.isConnected).toBe(false);
});
