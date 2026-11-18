/** @vitest-environment jsdom */
/**
 * Lifecycle controls for the native table hosts' SessionEdit inputs: entry
 * fences, merge/restore eligibility from the input's own published evidence,
 * observer faults, dispose with inputs in flight, and listener ownership.
 */
import { CommandCode } from '@macro-inc/collaboration/session/abi.generated';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import type { NativeTableEditOutcome } from './native-table-edit';
import { createNativeTableMoveHost } from './native-table-move';
import { createNativeTableResizeHost } from './native-table-resize';
import {
  initializeNativeTableTests,
  nativeTableSurface,
  restoreNativeTableTests,
} from './native-table-test-fixture';

beforeAll(initializeNativeTableTests);
afterAll(restoreNativeTableTests);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.unstubAllGlobals();
});

const TABLE = JSON.stringify({
  root: {
    type: 'root',
    version: 1,
    children: [
      {
        type: 'table',
        version: 1,
        colWidths: [100, 100],
        children: [['A', 'B']].map((cells) => ({
          type: 'tablerow',
          version: 1,
          children: cells.map((text) => ({
            type: 'tablecell',
            version: 1,
            children: [
              {
                type: 'paragraph',
                version: 1,
                children: [{ type: 'text', version: 1, text }],
              },
            ],
          })),
        })),
      },
      {
        type: 'paragraph',
        version: 1,
        children: [{ type: 'text', version: 1, text: 'after' }],
      },
    ],
  },
});
const REPLACED = JSON.stringify({
  root: {
    type: 'root',
    version: 1,
    children: [{ type: 'paragraph', version: 1, children: [] }],
  },
});

function mount() {
  const fixture = nativeTableSurface();
  cleanups.push(() => fixture.close());
  fixture.port.setState(TABLE);
  return fixture;
}
type Fixture = ReturnType<typeof mount>;
function firstCell(fixture: Fixture) {
  const cell = fixture.root.querySelector('td,th');
  if (!(cell instanceof HTMLElement)) throw new Error('Missing cell element');
  return cell;
}
function widths(fixture: Fixture): unknown {
  const state: unknown = JSON.parse(fixture.view.query.serializedState());
  if (
    !state ||
    typeof state !== 'object' ||
    !('root' in state) ||
    !state.root ||
    typeof state.root !== 'object' ||
    !('children' in state.root) ||
    !Array.isArray(state.root.children)
  )
    throw new Error('Unexpected serialized state');
  const table: unknown = state.root.children[0];
  return table && typeof table === 'object' && 'colWidths' in table
    ? table.colWidths
    : 'missing';
}
function resizeDrag(fixture: Fixture, canEdit: () => boolean = () => true) {
  const host = createNativeTableResizeHost(fixture.view, canEdit);
  cleanups.push(() => host.dispose());
  const cell = host.cellFromTarget(firstCell(fixture));
  if (!cell) throw new Error('Missing hit');
  const drag = host.beginDrag(cell, 'right', 1);
  if (!drag) throw new Error('Drag refused');
  return { host, drag };
}
const kinds = (outcomes: readonly NativeTableEditOutcome[]) =>
  outcomes.map((outcome) =>
    outcome.kind === 'refused'
      ? outcome.kind
      : `${outcome.kind}:${outcome.published}`
  );

test('resize: edit revoked between queued inputs stops the drag at the next entry', async () => {
  const fixture = mount();
  let canEdit = true;
  const { drag } = resizeDrag(fixture, () => canEdit);
  drag.apply(40);
  drag.apply(60);
  canEdit = false;
  await drag.settled();
  expect(kinds(drag.outcomes())).toEqual(['settled:true']);
  expect(widths(fixture)).toEqual([140, 100]);
  drag.restore();
  await drag.settled();
  expect(widths(fixture)).toEqual([140, 100]);
});

test('resize: the document replaced mid-drag stops later inputs and restore', async () => {
  const fixture = mount();
  const { drag } = resizeDrag(fixture);
  drag.apply(40);
  drag.apply(60);
  fixture.port.setState(REPLACED);
  const replaced = fixture.view.query.serializedState();
  drag.restore();
  await drag.settled();
  expect(fixture.view.query.serializedState()).toBe(replaced);
});

test('resize: restore with nothing published sends no input', async () => {
  const fixture = mount();
  const { drag } = resizeDrag(fixture);
  drag.restore();
  await drag.settled();
  expect(drag.outcomes()).toEqual([]);
  expect(widths(fixture)).toEqual([100, 100]);
});

test('resize: a commit observer that throws after publication still counts as published', async () => {
  const fixture = mount();
  const { drag } = resizeDrag(fixture);
  const release = fixture.view.onCommit(() => {
    throw new Error('observer fault');
  });
  drag.apply(40);
  await drag.settled();
  release();
  const [first] = drag.outcomes();
  // The observer's throw rejects the dispatch; the entry's own evidence still
  // shows it published.
  expect(first?.kind).toBe('failed');
  expect(first?.kind === 'failed' && String(first.error)).toBe(
    'Error: observer fault'
  );
  expect(first?.kind === 'failed' && first.published).toBe(true);
  expect(widths(fixture)).toEqual([140, 100]);
  // Merge follows the published evidence, so the next update and the
  // restore act on the same gesture.
  drag.apply(60);
  drag.restore();
  await drag.settled();
  expect(widths(fixture)).toEqual([100, 100]);
});

test('resize: dispose with an input in flight drops the rest; a new host works', async () => {
  const fixture = mount();
  const { host, drag } = resizeDrag(fixture);
  drag.apply(40);
  drag.apply(60);
  host.dispose();
  await drag.settled();
  const afterDispose = widths(fixture);
  drag.apply(80);
  drag.restore();
  await drag.settled();
  expect(widths(fixture)).toEqual(afterDispose);
  const next = resizeDrag(fixture);
  next.drag.apply(10);
  await next.drag.settled();
  expect(kinds(next.drag.outcomes())).toEqual(['settled:true']);
});

test('resize: layout registration owns its observer; none after dispose; no notify after release', () => {
  const constructed: Array<{ fire: () => void; disconnected: boolean }> = [];
  class TestResizeObserver {
    private readonly record: { fire: () => void; disconnected: boolean };
    constructor(callback: () => void) {
      this.record = { fire: callback, disconnected: false };
      constructed.push(this.record);
    }
    observe() {}
    unobserve() {}
    disconnect() {
      this.record.disconnected = true;
    }
  }
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  const fixture = mount();
  const host = createNativeTableResizeHost(fixture.view, () => true);
  let bumps = 0;
  const release = host.registerLayout(() => bumps++);
  expect(constructed).toHaveLength(1);
  release();
  expect(constructed[0]?.disconnected).toBe(true);
  constructed[0]?.fire();
  expect(bumps).toBe(0);
  host.dispose();
  expect(() => host.registerLayout(() => bumps++)).toThrow(
    'Table resize host is disposed'
  );
  expect(constructed).toHaveLength(1);
});

test('move: a menu action with no cell to act on settles unhandled, not published', async () => {
  const fixture = mount();
  const host = createNativeTableMoveHost(fixture.view, () => true);
  cleanups.push(() => host.dispose());
  const after = [...fixture.view.mirror.values()].find(
    (node) => node.kind === 'text' && node.text === 'after'
  );
  if (!after) throw new Error('Missing outside text');
  fixture.port.selectionFromView({
    kind: 'range',
    anchor: { key: after.key, offset: 0, type: 'text' },
    focus: { key: after.key, offset: 0, type: 'text' },
  });
  const before = fixture.view.query.serializedState();
  const outcome = await host.menuAction('delete-row', undefined);
  expect(kinds([outcome])).toEqual(['settled:false']);
  expect(fixture.view.query.serializedState()).toBe(before);
});

test('move: refused without edit, and after dispose, with no input', async () => {
  const fixture = mount();
  let canEdit = false;
  const host = createNativeTableMoveHost(fixture.view, () => canEdit);
  const before = fixture.view.query.serializedState();
  expect(await host.menuAction('delete-table', undefined)).toEqual({
    kind: 'refused',
  });
  canEdit = true;
  host.dispose();
  expect(await host.selectCells(undefined)).toEqual({ kind: 'refused' });
  expect(fixture.view.query.serializedState()).toBe(before);
  expect(host.elementFor({ index: 1, generation: 0 })).toBeUndefined();
  expect(host.rootElement()).toBeNull();
});

test('resize: a finished gesture is released, keeping its width, one undo step and the selection', async () => {
  const fixture = mount();
  fixture.port.command(CommandCode.ClearHistory);
  const before = widths(fixture);
  const selected = fixture.view.selection().selection;
  const { host, drag } = resizeDrag(fixture);
  expect(host.ownedDrags()).toBe(0);
  drag.apply(40);
  drag.apply(60);
  expect(host.ownedDrags()).toBe(1);
  await host.settled();
  // The gesture ends with no queued input: the host no longer owns it.
  expect(host.ownedDrags()).toBe(0);
  const after = widths(fixture);
  expect(after).not.toEqual(before);
  expect(fixture.view.selection().selection).toEqual(selected);
  // The whole gesture is one undo step back to the pre-drag widths.
  fixture.port.command(CommandCode.Undo);
  expect(widths(fixture)).toEqual(before);
  // A later input re-registers the drag only while that input works.
  drag.apply(10);
  expect(host.ownedDrags()).toBe(1);
  await host.settled();
  expect(host.ownedDrags()).toBe(0);
});
