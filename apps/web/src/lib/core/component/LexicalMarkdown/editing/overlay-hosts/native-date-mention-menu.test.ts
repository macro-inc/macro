import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import * as native from '@core/document-session/wasm/document_session_wasm.js';
import type { DateOption } from '@core/util/dateSearch/useDateSearch';
import {
  ABI_MAJOR,
  CommandCode,
  SessionInputMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import { DateMentionNode } from '@macro-inc/lexical-core';
import {
  clearDecorators,
  setDecorator,
} from '@macro-inc/lexical-core/decoratorRegistry';
import {
  createBuiltinRegistry,
  mountLocalSessionView,
  registerMacroDecoratorViews,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { NOOP_SPAN } from '@macro-inc/observability';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { DateMention } from '../../component/decorator/DateMention';
import { createNativeDateMentionContext } from '../../decorator-host/native-date-mention-host';
import { createNativeDateMentionViews } from '../../decorator-host/native-date-mention-views';
import { dispatchApplicationCommand } from '../../plugins/group-b/command';
import { createNativeUserMentionMenuHost } from './native-user-mention-menu';

const previousLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
beforeAll(() => {
  const own = resolve(import.meta.dirname, '../../../../document-session/wasm');
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: locks,
  });
  native.initSync({
    module: readFileSync(resolve(own, 'document_session_wasm_bg.wasm')),
  });
  setDecorator(DateMentionNode, DateMention);
});
afterAll(() => {
  clearDecorators();
  if (previousLocks) Object.defineProperty(navigator, 'locks', previousLocks);
  else Reflect.deleteProperty(navigator, 'locks');
});

const nodeSchema = z
  .object({
    type: z.string(),
    children: z.array(z.unknown()).optional(),
    text: z.string().optional(),
    date: z.string().nullable().optional(),
    displayFormat: z.string().nullable().optional(),
  })
  .passthrough();
const resources = new Set<() => Promise<void>>();
afterEach(async () => {
  let failed = false;
  let primary: unknown;
  for (const release of resources) {
    try {
      await release();
    } catch (cause) {
      if (!failed) {
        failed = true;
        primary = cause;
      }
    }
  }
  resources.clear();
  try {
    vi.restoreAllMocks();
  } catch (cause) {
    if (!failed) {
      failed = true;
      primary = cause;
    }
  }
  if (failed) throw primary;
});
function mount() {
  const root = document.createElement('div');
  document.body.append(root);
  let alive = true;
  let closed = false;
  let restoreInput = () => {};
  let disposeContext = () => {};
  let closeRuntime: () => void | Promise<void> = () => {};
  async function close() {
    if (closed) return;
    closed = true;
    alive = false;
    let failed = false;
    let primary: unknown;
    for (const release of [
      () => restoreInput(),
      () => disposeContext(),
      () => closeRuntime(),
      () => root.remove(),
    ]) {
      try {
        await release();
      } catch (cause) {
        if (!failed) {
          failed = true;
          primary = cause;
        }
      }
    }
    resources.delete(close);
    if (failed) throw primary;
  }
  // Register before context/session construction: even setup throws retire acquired resources.
  resources.add(close);
  const context = createNativeDateMentionContext({});
  disposeContext = () => context.dispose();
  const errors: unknown[] = [];
  const runtime = mountLocalSessionView(
    root,
    registerMacroDecoratorViews(
      registerMacroElementViews(createBuiltinRegistry()),
      createNativeDateMentionViews(context)
    ),
    {
      namespace: 'date-menu-controls',
      theme: {},
      editable: true,
      preset: 'rich',
      parentSpan: NOOP_SPAN,
      onError: (error) => errors.push(error),
    },
    {
      viewEngine: 1,
      viewOs: 0,
      nativeCommands: native,
      create: (config, now, wall) =>
        native.EditorSession.createMacroWithNamespace(
          ABI_MAJOR,
          config,
          now,
          wall,
          'date-menu-controls'
        ),
    }
  );
  closeRuntime = () => runtime.close();
  runtime.port.setState(
    JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [
          {
            type: 'paragraph',
            version: 1,
            children: [{ type: 'text', version: 1, text: 'body' }],
          },
        ],
      },
    })
  );
  const text = [...runtime.view.mirror.values()].find(
    (node) => node.kind === 'text'
  );
  if (!text) throw new Error('Actual native text missing');
  runtime.port.selectionFromView({
    kind: 'range',
    anchor: { key: text.key, offset: 0, type: 'text' },
    focus: { key: text.key, offset: 0, type: 'text' },
  });
  dispatchApplicationCommand(runtime.view, 'group-a.search-trigger', {
    kind: 'mentions',
  });
  runtime.port.command(CommandCode.InsertText, 0, 0, 'today');
  const host = createNativeUserMentionMenuHost(
    runtime.view,
    {
      sourceDocumentId: 'source-document',
      blockName: 'md',
      disableMentionTracking: false,
    },
    () => alive
  );
  const inputs: string[] = [];
  const actualInput = runtime.executor.session.input.bind(
    runtime.executor.session
  );
  const input = vi
    .spyOn(runtime.executor.session, 'input')
    .mockImplementation((bytes, ...rest) => {
      const message = SessionInputMsg.decode(bytes);
      if (message.editor.isEditorApplication())
        inputs.push(message.editor.value.name);
      return actualInput(bytes, ...rest);
    });
  restoreInput = () => input.mockRestore();
  function nodes(type: string) {
    const raw = z
      .object({ root: z.unknown() })
      .parse(JSON.parse(runtime.view.query.serializedState()));
    const found: z.infer<typeof nodeSchema>[] = [];
    function visit(value: unknown) {
      const node = nodeSchema.parse(value);
      if (node.type === type) found.push(node);
      for (const child of node.children ?? []) visit(child);
    }
    visit(raw.root);
    return found;
  }
  return {
    ...runtime,
    root,
    errors,
    host,
    inputs,
    nodes,
    retire() {
      alive = false;
    },
    authorize(write: boolean, comment = false) {
      runtime.executor.run(() =>
        runtime.executor.session.authorization(
          true,
          write,
          comment,
          runtime.executor.now(),
          Date.now()
        )
      );
    },
    healthy() {
      expect(runtime.view.isMounted).toBe(true);
      // Recovery is a separate explicit current-body operation. It does not
      // claim that cancelled picker work leaves the caret outside its search.
      const bodies = [...runtime.view.mirror.values()].filter(
        (node) =>
          node.kind === 'text' && node.type === 'text' && node.text === 'body'
      );
      expect(bodies).toHaveLength(1);
      const body = bodies[0];
      expect(body.text).toBe('body');
      runtime.port.selectionFromView({
        kind: 'range',
        anchor: { key: body.key, type: 'text', offset: 4 },
        focus: { key: body.key, type: 'text', offset: 4 },
      });
      runtime.port.command(CommandCode.InsertText, 0, 0, ' healthy');
      const after = runtime.view.mirror.node(body.key);
      expect(after?.kind).toBe('text');
      expect(after?.type).toBe('text');
      expect(after?.text).toBe('body healthy');
      expect(
        nodes('text').filter((node) => node.text === 'body healthy')
      ).toHaveLength(1);
    },
    close,
  };
}
function option(date = new Date('2026-06-15T23:59:59.999Z')) {
  const dateRead = vi.fn(() => date);
  const labelRead = vi.fn(() => 'Today');
  const data: DateOption = {
    id: 'today',
    type: 'preset',
    get date() {
      return dateRead();
    },
    get displayText() {
      return labelRead();
    },
  };
  return {
    item: { kind: 'date' as const, id: 'date-today', data },
    dateRead,
    labelRead,
  };
}

test('actual Date insertion removes search, renders real Date and accepts a next input', async () => {
  const runtime = mount();
  const choice = option();
  try {
    expect(runtime.nodes('inline-search')).toHaveLength(1);
    await runtime.host.select(choice.item);
    expect(runtime.inputs).toEqual([
      'group-a.search-remove',
      'group-a.insert-date-mention',
    ]);
    expect(runtime.nodes('inline-search')).toHaveLength(0);
    expect(runtime.nodes('date-mention')).toHaveLength(1);
    expect(runtime.nodes('date-mention')[0]).toMatchObject({
      date: '2026-06-15T23:59:59.999Z',
      displayFormat: 'Today',
    });
    expect(
      runtime.root.querySelector('[data-date]')?.getAttribute('data-date')
    ).toBe('2026-06-15T23:59:59.999Z');
    expect(choice.dateRead).toHaveBeenCalledTimes(1);
    expect(choice.labelRead).toHaveBeenCalledTimes(1);
    runtime.healthy();
    expect(runtime.errors).toEqual([]);
  } finally {
    await runtime.close();
  }
});

for (const after of [
  'retire',
  'access-read',
  'access-comment',
  'published-generation-mismatch',
] as const)
  for (const commandIndex of [1, 2])
    test(`queued ${after} before actual command ${commandIndex} skips Date materialization`, async () => {
      const runtime = mount();
      const choice = option();
      const actual = runtime.port.inputSettledIfSessionEdit.bind(runtime.port);
      const generation = runtime.view.mirror.keyGeneration;
      if (generation === null) throw new Error('Actual generation missing');
      let calls = 0;
      const settlements: Awaited<ReturnType<typeof actual>>[] = [];
      let resetGeneration: (() => void) | undefined;
      const scheduling = vi
        .spyOn(runtime.port, 'inputSettledIfSessionEdit')
        .mockImplementation((...args) => {
          if (++calls !== commandIndex) return actual(...args);
          let pending: ReturnType<typeof actual> | undefined;
          runtime.executor.run(() => {
            pending = actual(...args);
            if (after === 'retire') runtime.retire();
            if (after === 'published-generation-mismatch') {
              // Predicate-only injection: the real native epoch remains unchanged.
              // The producer's actual stale-generation control is separate Rust evidence.
              const reader = vi
                .spyOn(runtime.view.mirror, 'keyGeneration', 'get')
                .mockReturnValue(generation + 1);
              resetGeneration = () => reader.mockRestore();
            }
            return runtime.executor.session.authorization(
              true,
              after !== 'access-read' && after !== 'access-comment',
              after === 'access-comment',
              runtime.executor.now(),
              Date.now()
            );
          });
          if (!pending)
            throw new Error('Real queued conditional entry not accepted');
          return pending.then((result) => {
            settlements.push(result);
            return result;
          });
        });
      try {
        await runtime.host.select(choice.item);
        expect(settlements).toEqual([
          {
            status: 'cancelled',
            reason: after.startsWith('access-')
              ? 'session-access'
              : 'entry-admission',
          },
        ]);
        expect(choice.dateRead).not.toHaveBeenCalled();
        expect(choice.labelRead).not.toHaveBeenCalled();
        expect(runtime.inputs).toEqual(
          commandIndex === 1 ? [] : ['group-a.search-remove']
        );
        expect(runtime.nodes('date-mention')).toHaveLength(0);
        expect(runtime.nodes('inline-search')).toHaveLength(
          commandIndex === 1 ? 1 : 0
        );
        resetGeneration?.();
        resetGeneration = undefined;
        runtime.authorize(true);
        runtime.healthy();
        expect(runtime.errors).toEqual([]);
      } finally {
        resetGeneration?.();
        scheduling.mockRestore();
        await runtime.close();
      }
    });

for (const comment of [false, true])
  test(`initial Session Read (${comment}) skips both commands and Date getters; subsequent Edit works`, async () => {
    const runtime = mount();
    const choice = option();
    try {
      runtime.authorize(false, comment);
      await runtime.host.select(choice.item);
      expect(runtime.inputs).toEqual([]);
      expect(choice.dateRead).not.toHaveBeenCalled();
      expect(choice.labelRead).not.toHaveBeenCalled();
      expect(runtime.nodes('inline-search')).toHaveLength(1);
      runtime.authorize(true);
      runtime.healthy();
      expect(runtime.errors).toEqual([]);
    } finally {
      await runtime.close();
    }
  });

test('UI-only readonly with real Session Edit still completes Date insertion', async () => {
  const runtime = mount();
  const choice = option();
  try {
    runtime.view.setEditable(false);
    await runtime.host.select(choice.item);
    expect(runtime.nodes('date-mention')).toHaveLength(1);
    expect(runtime.inputs).toEqual([
      'group-a.search-remove',
      'group-a.insert-date-mention',
    ]);
    runtime.healthy();
    expect(runtime.errors).toEqual([]);
  } finally {
    await runtime.close();
  }
});

for (const failure of [undefined, null, { opaque: true }])
  test(`opaque getter rejection preserves actual REMOVE and next input (${typeof failure})`, async () => {
    const runtime = mount();
    const choice = option();
    choice.dateRead.mockImplementation(() => {
      throw failure;
    });
    const observed: { caught: boolean; error?: unknown } = { caught: false };
    try {
      try {
        await runtime.host.select(choice.item);
      } catch (error) {
        observed.caught = true;
        observed.error = error;
      }
      expect(observed.caught).toBe(true);
      expect(observed.error).toBe(failure);
      expect(runtime.inputs).toEqual(['group-a.search-remove']);
      expect(runtime.nodes('inline-search')).toHaveLength(0);
      expect(runtime.nodes('date-mention')).toHaveLength(0);
      expect(choice.dateRead).toHaveBeenCalledTimes(1);
      expect(choice.labelRead).not.toHaveBeenCalled();
      runtime.healthy();
      expect(runtime.errors.every((error) => error === observed.error)).toBe(
        true
      );
    } finally {
      await runtime.close();
    }
  });

test('invalid Date throws real RangeError after REMOVE without insertion; editor remains usable', async () => {
  const runtime = mount();
  const choice = option(new Date(Number.NaN));
  const observed: { error?: unknown } = {};
  try {
    try {
      await runtime.host.select(choice.item);
    } catch (error) {
      observed.error = error;
    }
    expect(observed.error).toBeInstanceOf(RangeError);
    expect(runtime.inputs).toEqual(['group-a.search-remove']);
    expect(runtime.nodes('inline-search')).toHaveLength(0);
    expect(runtime.nodes('date-mention')).toHaveLength(0);
    runtime.healthy();
    expect(runtime.errors.every((error) => error === observed.error)).toBe(
      true
    );
  } finally {
    await runtime.close();
  }
});

test('insertion consumes the later current model caret after REMOVE, not the old browser range', async () => {
  const runtime = mount();
  const choice = option();
  const actual = runtime.port.inputSettledIfSessionEdit.bind(runtime.port);
  let calls = 0;
  const scheduling = vi
    .spyOn(runtime.port, 'inputSettledIfSessionEdit')
    .mockImplementation((...args) => {
      if (++calls === 2) {
        const text = [...runtime.view.mirror.values()].find(
          (node) => node.kind === 'text' && node.text === 'body'
        );
        if (!text) throw new Error('Actual post-REMOVE text missing');
        runtime.port.selectionFromView({
          kind: 'range',
          anchor: { key: text.key, type: 'text', offset: 4 },
          focus: { key: text.key, type: 'text', offset: 4 },
        });
        const element = runtime.view.getElementByKey(text.key);
        const domText = element?.firstChild;
        if (!domText || domText.nodeType !== Node.TEXT_NODE)
          throw new Error('Actual DOM text missing');
        const range = document.createRange();
        range.setStart(domText, 0);
        range.collapse(true);
        const selection = document.getSelection();
        if (!selection) throw new Error('DOM Selection missing');
        selection.removeAllRanges();
        selection.addRange(range);
      }
      return actual(...args);
    });
  try {
    await runtime.host.select(choice.item);
    const paragraph = runtime.nodes('paragraph')[0];
    const children = (paragraph.children ?? []).map((child) =>
      nodeSchema.parse(child)
    );
    const bodyIndex = children.findIndex(
      (child) => child.type === 'text' && child.text === 'body'
    );
    const dateIndex = children.findIndex(
      (child) => child.type === 'date-mention'
    );
    expect(bodyIndex).toBeGreaterThanOrEqual(0);
    expect(dateIndex).toBeGreaterThan(bodyIndex);
    expect(runtime.nodes('date-mention')).toHaveLength(1);
    runtime.healthy();
    expect(runtime.errors).toEqual([]);
  } finally {
    scheduling.mockRestore();
    await runtime.close();
  }
});

test('completed but unhandled REMOVE is not an invented cancellation', async () => {
  const runtime = mount();
  const choice = option();
  try {
    dispatchApplicationCommand(runtime.view, 'group-a.search-remove', {});
    runtime.inputs.length = 0;
    await runtime.host.select(choice.item);
    expect(runtime.inputs).toEqual([
      'group-a.search-remove',
      'group-a.insert-date-mention',
    ]);
    expect(runtime.nodes('date-mention')).toHaveLength(1);
    runtime.healthy();
    expect(runtime.errors).toEqual([]);
  } finally {
    await runtime.close();
  }
});

for (const field of ['displayText', 'toISOString'] as const)
  for (const failure of [undefined, null, { opaque: true }])
    test(`opaque ${field} rejection keeps REMOVE and original cause (${typeof failure})`, async () => {
      const runtime = mount();
      const date = new Date('2026-06-15T23:59:59.999Z');
      const choice = option(date);
      const iso = vi.spyOn(date, 'toISOString');
      if (field === 'displayText')
        choice.labelRead.mockImplementation(() => {
          throw failure;
        });
      else
        iso.mockImplementation(() => {
          throw failure;
        });
      const observed: { caught: boolean; error?: unknown } = { caught: false };
      try {
        try {
          await runtime.host.select(choice.item);
        } catch (error) {
          observed.caught = true;
          observed.error = error;
        }
        expect(observed.caught).toBe(true);
        expect(observed.error).toBe(failure);
        expect(runtime.inputs).toEqual(['group-a.search-remove']);
        expect(runtime.nodes('inline-search')).toHaveLength(0);
        expect(runtime.nodes('date-mention')).toHaveLength(0);
        expect(choice.dateRead).toHaveBeenCalledTimes(1);
        expect(iso).toHaveBeenCalledTimes(1);
        expect(choice.labelRead).toHaveBeenCalledTimes(
          field === 'displayText' ? 1 : 0
        );
        runtime.healthy();
        expect(runtime.errors.every((error) => error === observed.error)).toBe(
          true
        );
      } finally {
        iso.mockRestore();
        await runtime.close();
      }
    });
