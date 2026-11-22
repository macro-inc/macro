// @vitest-environment jsdom
import { writeFileSync } from 'node:fs';
import { registerRichText } from '@lexical/rich-text';
import { EditorInputMsg } from '@macro-inc/collaboration/session/abi.generated';
import { DatabaseQueryNode } from '@macro-inc/lexical-core/nodes/DatabaseQueryNode';
import { INITIALIZE_DOCUMENT_IDS } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import {
  initializeInputCommitFixture,
  mountInputCommitFixture,
} from '@macro-inc/lexical-wasm-view/view/input-commit-test-fixture';
import { registerMacroDecoratorViews } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import { selectionMessage } from '@macro-inc/lexical-wasm-view/view/session-port';
import type { Point } from '@macro-inc/lexical-wasm-view/view/types';
import { Telemetry } from '@macro-inc/observability';
import {
  $getNodeByKey,
  $getPreviousSelection,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $nodesOfType,
  $setSelection,
} from 'lexical';
import { urlAlphabet } from 'nanoid';
import { createRoot } from 'solid-js';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { createLexicalWrapper } from '../../context/LexicalWrapperContext';
import { ACTIONS } from '../../plugins/actions/actions';
import { createNativeActionMenuHost } from './native-actions';

// Historical constructor-only oracle remains archived; this control imports the actual same input JSON.

// Observe the original action Promise, calling actual fireAndForget unchanged.
const observed = vi.hoisted(() => ({ tasks: [] as unknown[] }));
vi.mock('@core/util/fireAndForget', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@core/util/fireAndForget')>();
  return {
    fireAndForget(work: unknown, surface: string) {
      if (surface === 'native-action-menu') observed.tasks.push(work);
      return actual.fireAndForget(work, surface);
    },
  };
});
const records: unknown[] = [];
// Raw opaque causes stay private; emitted diagnostics never coerce them.
const retained: {
  label: string;
  primary: { error: unknown } | undefined;
  secondary: unknown[];
}[] = [];
type Own = (release: () => unknown) => void;
async function control(label: string, body: (own: Own) => Promise<void>) {
  const releases: Array<() => unknown> = [];
  const own: Own = (release) => {
    releases.push(release);
  };
  let primary: { error: unknown } | undefined;
  try {
    await body(own);
  } catch (error) {
    primary = { error };
  }
  const secondary: unknown[] = [];
  for (const release of releases.reverse()) {
    try {
      await release();
    } catch (error) {
      secondary.push(error);
    }
  }
  retained.push({ label, primary, secondary });
  if (primary !== undefined) throw primary.error;
  if (secondary.length) throw secondary[0];
}
let restore: (() => void) | undefined;
beforeAll(() => {
  restore = initializeInputCommitFixture();
});
afterAll(() => {
  try {
    if (process.env.QUERY_CALLBACK_PROOF)
      writeFileSync(
        process.env.QUERY_CALLBACK_PROOF,
        JSON.stringify(
          {
            records,
            lifecycle: retained.map(({ label, primary, secondary }) => ({
              label,
              primaryPresent: primary !== undefined,
              primaryType: primary === undefined ? null : typeof primary.error,
              secondaryTypes: secondary.map((error) => typeof error),
            })),
          },
          null,
          2
        )
      );
  } finally {
    restore?.();
  }
});
const inputState = JSON.stringify({
  root: {
    type: 'root',
    version: 1,
    children: [
      {
        type: 'paragraph',
        version: 1,
        children: [{ type: 'text', version: 1, text: 'Before. After.' }],
      },
    ],
  },
});
const queryMatch = ACTIONS.find((action) => action.id === 'database-query');
if (!queryMatch) throw new Error('Source Query missing');
const query = queryMatch;
type Runtime = ReturnType<typeof mountInputCommitFixture>;
function mount(own: Own): Runtime {
  const runtime = mountInputCommitFixture();
  own(() => runtime.root.remove());
  own(() => runtime.close());
  // Recording-only sink: no Source decorator UI or DOM/navigation parity.
  registerMacroDecoratorViews(runtime.view.registry, {
    'database-query': () => {
      const node = document.createElement('span');
      node.dataset.querySink = 'no-ui';
      return node;
    },
  });
  runtime.port.setState(inputState);
  expect(runtime.view.isMounted).toBe(true);
  expect(runtime.view.mirror.keyGeneration).not.toBeNull();
  return runtime;
}
function hostFor(
  runtime: Runtime,
  own: Own,
  current: () => boolean = () => true
) {
  const host = createNativeActionMenuHost(
    runtime.view,
    { requestTable() {} },
    current
  );
  own(() => host.dispose());
  return host;
}
function queryCount(runtime: Runtime) {
  return [...runtime.view.mirror.values()].filter(
    (node) => node.type === 'database-query'
  ).length;
}
function sourcePoint(key: string, offset: number, type: 'text' | 'element') {
  let node = $getNodeByKey(key);
  if (!node) throw new Error('Source point missing');
  const path: number[] = [];
  for (let parent = node.getParent(); parent; parent = node.getParent()) {
    path.unshift(node.getIndexWithinParent());
    node = parent;
  }
  return { path, offset, type };
}
function sourceSelection() {
  const selected = $getSelection();
  if (selected === null) return { kind: 'none' };
  if (!$isRangeSelection(selected))
    throw new Error('Unexpected Source selection');
  return {
    kind: 'range',
    anchor: sourcePoint(
      selected.anchor.key,
      selected.anchor.offset,
      selected.anchor.type
    ),
    focus: sourcePoint(
      selected.focus.key,
      selected.focus.offset,
      selected.focus.type
    ),
    format: selected.format,
    style: selected.style,
  };
}
function nativeSelection(runtime: Runtime) {
  const { selection, format, style } = runtime.view.selection();
  if (selection.kind === 'none') return { kind: 'none' };
  if (selection.kind !== 'range')
    throw new Error('Unexpected native selection');
  const point = (value: Point) => {
    let node = runtime.view.node(value.key);
    if (!node) throw new Error('Native point missing');
    const path: number[] = [];
    while (node.parent !== null) {
      const parent = runtime.view.node(node.parent);
      if (!parent) throw new Error('Native parent missing');
      path.unshift(parent.children.indexOf(node.key));
      node = parent;
    }
    return { path, offset: value.offset, type: value.type };
  };
  return {
    kind: 'range',
    anchor: point(selection.anchor),
    focus: point(selection.focus),
    format,
    style,
  };
}
type SourceMode = 'caret' | 'null' | 'committed-null-sequence' | 'queued-caret';
async function sourceOracle(mode: SourceMode, own: Own) {
  const wrapper = createRoot((dispose) => {
    own(dispose);
    const created = createLexicalWrapper({
      type: 'markdown-sync',
      namespace: 'block-md-main',
      isInteractable: () => true,
      withIds: true,
    });
    own(() => created.cleanup());
    return created;
  });
  const editor = wrapper.editor;
  const root = document.createElement('div');
  own(() => root.remove());
  own(() => editor.setRootElement(null));
  root.contentEditable = 'true';
  document.body.append(root);
  editor.setRootElement(root);
  own(registerRichText(editor));
  // Source uses its real parser and Node-ID initialization on the exact Native input string.
  editor.setEditorState(editor.parseEditorState(inputState));
  expect(editor.dispatchCommand(INITIALIZE_DOCUMENT_IDS, undefined)).toBe(true);
  editor.read(() => {});
  if (mode !== 'null')
    editor.update(
      () => {
        const text = $getRoot().getFirstDescendant();
        if (!text) throw new Error('Source imported text absent');
        text.selectStart();
        const selected = $getSelection();
        if (!$isRangeSelection(selected))
          throw new Error('Source imported range absent');
        selected.anchor.set(text.getKey(), 8, 'text');
        selected.focus.set(text.getKey(), 8, 'text');
      },
      { discrete: true }
    );
  if (mode === 'committed-null-sequence')
    editor.update(() => $setSelection(null), { discrete: true });
  if (mode === 'queued-caret')
    editor.update(
      () => {
        const text = $getRoot().getFirstDescendant();
        if (!text) throw new Error('Source text absent');
        text.selectStart();
      },
      { discrete: true }
    );
  const before = editor.read(() => ({
    json: JSON.parse(JSON.stringify(editor.getEditorState().toJSON())),
    current: sourceSelection(),
    previousNull: $getPreviousSelection() === null,
  }));
  if (mode === 'null') {
    expect(before.current).toEqual({ kind: 'none' });
    expect(before.previousNull).toBe(true);
  }
  if (mode === 'committed-null-sequence') {
    expect(before.current).toEqual({ kind: 'none' });
    expect(before.previousNull).toBe(true);
  }
  let resolveWait!: () => void;
  let rejectWait!: (error: unknown) => void;
  const wait = new Promise<void>((resolve, reject) => {
    resolveWait = resolve;
    rejectWait = reject;
  });
  const outcome = wait.then(
    () => ({ ok: true as const }),
    (error) => ({ ok: false as const, error })
  );
  const timer = setTimeout(
    () => rejectWait(new Error('Source actual Query commit timed out')),
    3000
  );
  own(() => {
    clearTimeout(timer);
    rejectWait(new Error('Source control retired'));
  });
  own(
    editor.registerUpdateListener(({ editorState }) => {
      try {
        editorState.read(() => {
          if ($nodesOfType(DatabaseQueryNode).length === 1) resolveWait();
        });
      } catch (error) {
        rejectWait(error);
      }
    })
  );
  query.action(editor);
  const result = await outcome;
  if (!result.ok) throw result.error;
  const after = editor.read(() => ({
    json: JSON.parse(JSON.stringify(editor.getEditorState().toJSON())),
    selection: sourceSelection(),
  }));
  records.push({ sourceMode: mode, before, ...after });
  return { ...after, before };
}
function textKey(runtime: Runtime) {
  const text = [...runtime.view.mirror.values()].find(
    (node) => node.type === 'text'
  );
  if (!text) throw new Error('Actual text absent');
  return text.key;
}
function domCaret(runtime: Runtime, key: number, offset: number) {
  const dom = runtime.view.getElementByKey(key)?.firstChild;
  if (!dom) throw new Error('Actual text DOM absent');
  const range = document.createRange();
  range.setStart(dom, offset);
  range.collapse(true);
  const selection = document.getSelection();
  if (!selection) throw new Error('Actual DOM selection absent');
  selection.removeAllRanges();
  selection.addRange(range);
  expect(selection.anchorNode).toBe(dom);
  expect(selection.anchorOffset).toBe(offset);
}
async function select(runtime: Runtime, offset: number | null) {
  const key = textKey(runtime);
  if (offset !== null) domCaret(runtime, key, offset);
  const selected =
    offset === null
      ? { kind: 'none' as const }
      : {
          kind: 'range' as const,
          anchor: { key, type: 'text' as const, offset },
          focus: { key, type: 'text' as const, offset },
        };
  const result = await runtime.port.inputSettled(
    EditorInputMsg.fromEditorSelection({
      selection: selectionMessage(selected),
      change: {},
    })
  );
  expect(result.status).toBe('success');
}
async function act(host: ReturnType<typeof createNativeActionMenuHost>) {
  const start = observed.tasks.length;
  host.select(query, 'keyboard');
  expect(observed.tasks.length).toBe(start + 1);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      observed.tasks[start],
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Actual action did not settle in 3s')),
          3000
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
type IDPairing = { forward: Map<string, string>; reverse: Map<string, string> };
function assertID(value: unknown): asserts value is string {
  expect(typeof value).toBe('string');
  if (typeof value !== 'string') throw new Error('Missing actual node ID');
  expect(value.length).toBe(8);
  expect([...value].every((character) => urlAlphabet.includes(character))).toBe(
    true
  );
}
function validateNodeIDs(nodes: unknown, seen: Set<string> = new Set()) {
  if (!Array.isArray(nodes)) throw new Error('Actual node array absent');
  for (const node of nodes) {
    if (!isRecord(node) || !isRecord(node.$))
      throw new Error('Actual node ID state absent');
    assertID(node.$.id);
    expect(seen.has(node.$.id)).toBe(false);
    seen.add(node.$.id);
    if ('children' in node) validateNodeIDs(node.children, seen);
  }
}
// Compare every JSON key/value. Only generated $.id VALUES use the reviewed bijection;
// raw models remain intact and the mapping persists from before Query to after Query.
function compareJSON(
  source: unknown,
  native: unknown,
  ids: IDPairing,
  path: string[] = []
) {
  if (Array.isArray(source)) {
    if (!Array.isArray(native)) throw new Error('Native array shape differs');
    expect(native.length).toBe(source.length);
    source.forEach((value, index) =>
      compareJSON(value, native[index], ids, [...path, String(index)])
    );
    return;
  }
  if (isRecord(source)) {
    if (!isRecord(native)) throw new Error('Native object shape differs');
    expect(Object.keys(native).sort()).toEqual(Object.keys(source).sort());
    for (const key of Object.keys(source)) {
      if (key === 'id' && path.at(-1) === '$') {
        const sourceID = source[key],
          nativeID = native[key];
        assertID(sourceID);
        assertID(nativeID);
        const mapped = ids.forward.get(sourceID);
        if (mapped !== undefined) {
          expect(nativeID).toBe(mapped);
          expect(ids.reverse.get(nativeID)).toBe(sourceID);
        } else {
          expect(ids.reverse.has(nativeID)).toBe(false);
          ids.forward.set(sourceID, nativeID);
          ids.reverse.set(nativeID, sourceID);
        }
      } else compareJSON(source[key], native[key], ids, [...path, key]);
    }
    return;
  }
  expect(native).toEqual(source);
}
function pairBefore(
  runtime: Runtime,
  oracle: Awaited<ReturnType<typeof sourceOracle>>
) {
  const model = JSON.parse(runtime.executor.session.serializedState());
  const ids: IDPairing = { forward: new Map(), reverse: new Map() };
  records.push({
    phase: 'before-query',
    sourceModel: oracle.before.json,
    nativeModel: model,
    sourceSelection: oracle.before.current,
    nativeSelection: nativeSelection(runtime),
  });
  validateNodeIDs(oracle.before.json.root.children);
  validateNodeIDs(model.root.children);
  compareJSON(oracle.before.json.root.children, model.root.children, ids);
  expect(nativeSelection(runtime)).toEqual(oracle.before.current);
  return ids;
}
function assertOracle(
  runtime: Runtime,
  oracle: Awaited<ReturnType<typeof sourceOracle>>,
  ids: IDPairing
) {
  const model = JSON.parse(runtime.executor.session.serializedState());
  records.push({
    phase: 'after-query',
    sourceModel: oracle.json,
    nativeModel: model,
    sourceSelection: oracle.selection,
    nativeSelection: nativeSelection(runtime),
    sink: 'recording-only/no-UI',
  });
  validateNodeIDs(oracle.json.root.children);
  validateNodeIDs(model.root.children);
  compareJSON(oracle.json.root.children, model.root.children, ids);
  expect(nativeSelection(runtime)).toEqual(oracle.selection);
  records.push({ idBijection: [...ids.forward] });
}
for (const mode of ['caret', 'null', 'committed-null-sequence'] as const)
  test(
    `paired Source and native Query ${mode}`,
    async () =>
      control(mode, async (own) => {
        const oracle = await sourceOracle(mode, own);
        const runtime = mount(own);
        const host = hostFor(runtime, own);
        const trace: string[] = [];
        if (mode === 'caret') await select(runtime, 8);
        if (mode === 'committed-null-sequence') {
          await select(runtime, 8);
          await select(runtime, null);
          expect(nativeSelection(runtime)).toEqual({ kind: 'none' });
        }
        if (mode === 'null')
          expect(nativeSelection(runtime)).toEqual({ kind: 'none' });
        // Fresh null mode starts from actual new Session/import, with no Range input ever issued.
        // No public previous-selection getter exists; no private previous-range assertion is invented.
        const original = runtime.port.inputSettled.bind(runtime.port);
        const removal = vi.spyOn(runtime.port, 'inputSettled');
        own(() => removal.mockRestore());
        removal.mockImplementation((input, options) => {
          const promise = original(input, options);
          trace.push('remove-call');
          promise.then(
            () => {
              trace.push('remove-settled');
              queueMicrotask(() => trace.push('removal-microtask'));
            },
            () => {}
          );
          return promise;
        });
        let ids: IDPairing | undefined;
        const entry = runtime.port.inputSettledIfSessionEdit.bind(runtime.port);
        const admission = vi.spyOn(runtime.port, 'inputSettledIfSessionEdit');
        own(() => admission.mockRestore());
        admission.mockImplementation((factory, options) =>
          entry(() => {
            trace.push('query-factory');
            ids = pairBefore(runtime, oracle);
            return factory();
          }, options)
        );
        await act(host);
        expect(queryCount(runtime)).toBe(1);
        expect(trace.indexOf('remove-settled')).toBeGreaterThanOrEqual(0);
        expect(trace.indexOf('remove-settled')).toBeLessThan(
          trace.indexOf('removal-microtask')
        );
        expect(trace.indexOf('removal-microtask')).toBeLessThan(
          trace.indexOf('query-factory')
        );
        if (!ids) throw new Error('Actual Query entry correlation absent');
        assertOracle(runtime, oracle, ids);
        records.push({ mode, trace });
      }),
    12000
  );

for (const boundary of [
  'access',
  'dispose',
  'rebind',
  'retire',
  'caret',
] as const)
  test(
    `actual busy FIFO ${boundary} before Query factory`,
    async () =>
      control(boundary, async (own) => {
        const oracle =
          boundary === 'caret'
            ? await sourceOracle('queued-caret', own)
            : undefined;
        const runtime = mount(own);
        let current = true;
        const host = hostFor(runtime, own, () => current);
        await select(runtime, 8);
        const entry = runtime.port.inputSettledIfSessionEdit.bind(runtime.port);
        let ids: IDPairing | undefined;
        let factories = 0;
        let queued = false;
        const trace: string[] = [];
        let replacement: Runtime | undefined;
        const admission = vi.spyOn(runtime.port, 'inputSettledIfSessionEdit');
        own(() => admission.mockRestore());
        admission.mockImplementation((factory, options) => {
          let pending: ReturnType<typeof entry> | undefined;
          runtime.executor.run(() => {
            expect(runtime.executor.metadataReadIdle).toBe(false);
            if (boundary === 'caret') {
              const key = textKey(runtime);
              domCaret(runtime, key, 0);
              runtime.port.selectionFromView({
                kind: 'range',
                anchor: { key, type: 'text', offset: 0 },
                focus: { key, type: 'text', offset: 0 },
              });
            }
            pending = entry(() => {
              factories++;
              trace.push('factory');
              if (boundary === 'caret') {
                if (!oracle) throw new Error('Source zero control absent');
                ids = pairBefore(runtime, oracle);
              }
              return factory();
            }, options);
            expect(factories).toBe(0);
            queued = true;
            trace.push('queued-before-invalidation');
            if (boundary === 'dispose') {
              current = false;
              host.dispose();
            }
            if (boundary === 'retire' || boundary === 'rebind')
              runtime.view.dispose();
            if (boundary === 'rebind') replacement = mount(own);
            trace.push('invalidated-before-factory');
            return boundary === 'access'
              ? runtime.executor.session.authorization(
                  true,
                  false,
                  false,
                  runtime.executor.now(),
                  Date.now()
                )
              : runtime.executor.session.tick(
                  runtime.executor.now(),
                  Date.now()
                );
          });
          if (!pending) throw new Error('Actual queued input absent');
          return pending;
        });
        await act(host);
        expect(queued).toBe(true);
        expect(factories).toBe(boundary === 'caret' ? 1 : 0);
        if (boundary !== 'retire' && boundary !== 'rebind')
          expect(queryCount(runtime)).toBe(boundary === 'caret' ? 1 : 0);
        if (replacement) expect(queryCount(replacement)).toBe(0);
        if (boundary === 'caret') {
          if (!oracle || !ids)
            throw new Error('Actual current-zero correlation absent');
          assertOracle(runtime, oracle, ids);
        }
        records.push({
          boundary,
          trace,
          factories,
          model: runtime.executor.session.serializedState(),
        });
        admission.mockRestore();
        if (boundary === 'access')
          runtime.executor.run(() =>
            runtime.executor.session.authorization(
              true,
              true,
              true,
              runtime.executor.now(),
              Date.now()
            )
          );
        if (boundary !== 'retire' && boundary !== 'rebind') {
          const healthy = hostFor(runtime, own);
          await act(healthy);
          expect(queryCount(runtime)).toBe(boundary === 'caret' ? 2 : 1);
        }
      }),
    12000
  );

for (const error of [undefined, null, { opaque: 'query-observer' }])
  test(`opaque Query output ${typeof error}`, async () =>
    control(`opaque-${typeof error}`, async (own) => {
      const runtime = mount(own);
      const host = hostFor(runtime, own);
      const report = vi.spyOn(Telemetry, 'error');
      own(() => report.mockRestore());
      const entry = runtime.port.inputSettledIfSessionEdit.bind(runtime.port);
      const admission = vi.spyOn(runtime.port, 'inputSettledIfSessionEdit');
      own(() => admission.mockRestore());
      admission.mockImplementation((factory, options) => {
        let release: () => void = () => {};
        release = runtime.view.onCommit(() => {
          release();
          throw error;
        });
        own(() => release());
        return entry(factory, options);
      });
      await expect(act(host)).rejects.toBe(error);
      expect(queryCount(runtime)).toBe(1);
      expect(
        report.mock.calls.some(
          ([cause, options]) =>
            cause === error && options?.surface === 'native-action-menu'
        )
      ).toBe(true);
      admission.mockRestore();
      await act(host);
      expect(queryCount(runtime)).toBe(2);
    }));
// Fixture lifecycle controls, not native behavior REDs or receipt evidence.
test('protected setup drains every resource and retains opaque primary and secondary', async () => {
  const releases: string[] = [];
  const secondary = { cleanup: 'opaque' };
  await expect(
    control('fixture-setup-fault', async (own) => {
      own(() => {
        releases.push('first');
      });
      own(() => {
        releases.push('second');
        throw secondary;
      });
      throw undefined;
    })
  ).rejects.toBeUndefined();
  expect(releases).toEqual(['second', 'first']);
  const saved = retained.at(-1);
  expect(saved?.primary).toEqual({ error: undefined });
  expect(saved?.secondary).toEqual([secondary]);
});

// Pure comparison-rule controls; no native operation or receipt authority.
test('ID rule rejects absent/duplicate/swapped IDs and a kept ID on the wrong split half', () => {
  const make = (a: string, b: string) => [
    {
      type: 'paragraph',
      $: { id: 'pSOURCE1' },
      children: [
        { type: 'text', $: { id: a }, text: 'before' },
        { type: 'text', $: { id: b }, text: 'after' },
      ],
    },
  ];
  const source = make('sKEEP001', 'sNEW0001');
  const native = make('nKEEP001', 'nNEW0001');
  native[0].$.id = 'pNATIVE1';
  const fresh = (): IDPairing => ({ forward: new Map(), reverse: new Map() });
  const ids = fresh();
  validateNodeIDs(source);
  validateNodeIDs(native);
  compareJSON(source, native, ids);
  const raw = JSON.stringify(native);
  compareJSON(source, native, ids);
  expect(JSON.stringify(native)).toBe(raw);
  const swapped = make('nNEW0001', 'nKEEP001');
  swapped[0].$.id = 'pNATIVE1';
  expect(() => compareJSON(source, swapped, ids)).toThrow();
  expect(() => validateNodeIDs(make('sameID01', 'sameID01'))).toThrow();
  expect(() => validateNodeIDs([{ type: 'text', text: 'missing' }])).toThrow();
  const wrongHalf = make('nNEW0002', 'nKEEP001');
  wrongHalf[0].$.id = 'pNATIVE1';
  expect(() => compareJSON(source, wrongHalf, ids)).toThrow();
  expect(() =>
    compareJSON(source, [{ ...native[0], format: 'changed' }], ids)
  ).toThrow();
});
