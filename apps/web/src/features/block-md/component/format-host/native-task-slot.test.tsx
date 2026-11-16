import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import type { ParsedCheckbox } from '@core/component/LexicalMarkdown/plugins/checkbox-to-task/types';
import * as native from '@core/document-session/wasm/document_session_wasm.js';
import { ABI_MAJOR } from '@macro-inc/collaboration/session/abi.generated';
import {
  createBuiltinRegistry,
  mountLocalSessionView,
  registerMacroDecoratorViews,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { NOOP_SPAN } from '@macro-inc/observability';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { createNativeTaskSlot } from './native-task-slot';

// Only task creation crosses the service boundary (as in Source's
// checkbox-task-conversion test); parsing and replacement are the model's.
const API = vi.hoisted(() => ({
  create:
    vi.fn<
      (
        checkbox: ParsedCheckbox,
        options: { currentUserId?: string; parentTaskId?: string }
      ) => Promise<string | null>
    >(),
}));
vi.mock('@core/util/taskCreation', () => ({ createTaskFromData: API.create }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), failure: vi.fn() }));
vi.mock('@core/component/Toast/Toast', () => ({ toast: toasts }));
const composer = vi.hoisted(() => ({
  createPopoverSplit: vi.fn(),
  trackMention: vi.fn(),
  untrackMention: vi.fn(async () => {}),
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({
    createPopoverSplit: composer.createPopoverSplit,
  }),
}));
vi.mock('@core/signal/mention', () => ({
  trackMention: composer.trackMention,
  untrackMention: composer.untrackMention,
}));

const previousLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
beforeAll(() => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: locks,
  });
  native.initSync({
    module: readFileSync(
      resolve(
        import.meta.dirname,
        '../../../../lib/core/document-session/wasm/document_session_wasm_bg.wasm'
      )
    ),
  });
});
afterAll(() => {
  if (previousLocks) Object.defineProperty(navigator, 'locks', previousLocks);
  else Reflect.deleteProperty(navigator, 'locks');
});
beforeEach(() => {
  API.create.mockReset();
  toasts.success.mockReset();
  toasts.failure.mockReset();
  composer.createPopoverSplit.mockReset();
  composer.trackMention.mockReset();
  composer.trackMention.mockResolvedValue('uuid-1');
  composer.untrackMention.mockClear();
});

function mount(titles: string[]) {
  const root = document.createElement('div');
  document.body.append(root);
  const errors: unknown[] = [];
  const runtime = mountLocalSessionView(
    root,
    registerMacroDecoratorViews(
      registerMacroElementViews(createBuiltinRegistry()),
      { 'document-mention': () => null }
    ),
    {
      namespace: 'checkbox-tasks',
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
          'checkbox-tasks'
        ),
    }
  );
  runtime.port.setState(
    JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [
          {
            type: 'list',
            version: 1,
            listType: 'check',
            tag: 'ul',
            start: 1,
            children: titles.map((text, index) => ({
              type: 'listitem',
              version: 1,
              value: index + 1,
              checked: false,
              children: [{ type: 'text', version: 1, text }],
            })),
          },
        ],
      },
    })
  );
  const texts = [...runtime.view.mirror.values()].filter(
    (node) => node.kind === 'text'
  );
  const first = texts[0];
  const last = texts.at(-1);
  if (!first || !last) throw new Error('Missing checklist text');
  runtime.port.selectionFromView({
    kind: 'range',
    anchor: { key: first.key, offset: 0, type: 'text' },
    focus: { key: last.key, offset: last.text.length, type: 'text' },
  });
  return {
    ...runtime,
    errors,
    nodes: (type: string) =>
      [...runtime.view.mirror.values()].filter((node) => node.type === type),
    async close() {
      await runtime.close();
      root.remove();
    },
  };
}

function slot(runtime: ReturnType<typeof mount>, canEdit = true) {
  const [selection, setSelection] = createSignal(0);
  const task = createNativeTaskSlot({
    view: () => runtime.view,
    canEdit: () => canEdit,
    currentUserId: () => 'user-1',
    parentTaskId: 'parent-1',
    documentId: () => 'doc-1',
    documentName: () => 'Plan',
    selection,
    selectionText: () => 'selected text',
  });
  return { task, reselect: () => setSelection(selection() + 1) };
}

// Source MarkdownPopup: several selected checklist items make "N tasks".
test('a selection over several checklist items offers "N tasks" and converts them', async () => {
  API.create.mockResolvedValueOnce('task-1').mockResolvedValueOnce('task-2');
  const runtime = mount(['first', 'second']);
  try {
    const { task } = slot(runtime);
    expect(task.available()).toBe(true);
    expect(task.touchLabel?.()).toBe('2 tasks');
    const hide = vi.fn();
    render(() => task.button?.({ open: () => {}, close: hide }));
    fireEvent.click(screen.getByText('2 tasks'));
    expect(task.converting?.()).toBe(true);
    expect(API.create).toHaveBeenCalledTimes(2);
    expect(API.create.mock.calls[0][1]).toEqual({
      currentUserId: 'user-1',
      parentTaskId: 'parent-1',
    });
    await vi.waitFor(() => expect(hide).toHaveBeenCalledOnce());
    expect(task.converting?.()).toBe(false);
    expect(toasts.success).toHaveBeenCalledWith('Created 2 tasks');
    expect(toasts.failure).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(runtime.nodes('document-mention')).toHaveLength(2)
    );
  } finally {
    await runtime.close();
  }
});

test('a failed creation reports the Source failure toast', async () => {
  API.create
    .mockResolvedValueOnce('task-1')
    .mockRejectedValueOnce(new Error('request failed'));
  const runtime = mount(['first', 'second']);
  try {
    const { task } = slot(runtime);
    const hide = vi.fn();
    task.select?.(hide);
    await vi.waitFor(() => expect(hide).toHaveBeenCalledOnce());
    expect(toasts.success).toHaveBeenCalledWith('Created 1 task');
    expect(toasts.failure).toHaveBeenCalledWith(
      'Some checklist items could not become tasks'
    );
  } finally {
    await runtime.close();
  }
});

test('one checklist item offers Source\'s single "Task", and no edit access no "N tasks"', async () => {
  const single = mount(['only']);
  try {
    const { task } = slot(single);
    expect(task.available()).toBe(true);
    expect(task.touchLabel?.()).toBe('Task');
  } finally {
    await single.close();
  }
  const readOnly = mount(['first', 'second']);
  try {
    expect(slot(readOnly, false).task.touchLabel?.()).toBe('Task');
  } finally {
    await readOnly.close();
  }
});

function mountParagraph(text: string, from: number, to: number) {
  const runtime = mount(['placeholder']);
  runtime.port.setState(
    JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [
          {
            type: 'paragraph',
            version: 1,
            children: [{ type: 'text', version: 1, text }],
          },
        ],
      },
    })
  );
  const leaf = runtime.nodes('text')[0];
  runtime.port.selectionFromView({
    kind: 'range',
    anchor: { key: leaf.key, offset: from, type: 'text' },
    focus: { key: leaf.key, offset: to, type: 'text' },
  });
  return runtime;
}

const paragraphText = (runtime: ReturnType<typeof mount>) => {
  const paragraph = runtime.view.mirror.node(
    runtime.view.mirror.node(0)?.children[0] ?? -1
  );
  return (paragraph?.children ?? [])
    .map((key) => {
      const node = runtime.view.mirror.node(key);
      return node?.type === 'document-mention'
        ? `[${String(node.props().documentName)}]`
        : (node?.text ?? '');
    })
    .join('');
};

// Source handleCreateTask's snippet branch: open the composer, then link
// each created task after the snippet.
test('"Task" opens the composer on the snippet and links created tasks after it', async () => {
  const runtime = mountParagraph('buy milk today.', 4, 8);
  try {
    const { task } = slot(runtime);
    expect(task.touchLabel?.()).toBe('Task');
    const hide = vi.fn();
    task.select?.(hide);
    expect(hide).toHaveBeenCalledOnce();
    const params = composer.createPopoverSplit.mock.calls[0][0].content.params;
    expect(params.initialTitle).toBe('milk');
    expect(params.initialContent).toContain('doc-1');
    params.linkInSource.insert({ documentId: 'task-1', title: 'One' });
    await vi.waitFor(() =>
      expect(paragraphText(runtime)).toBe('buy milk [One] today.')
    );
    expect(composer.trackMention).toHaveBeenCalledWith(
      'doc-1',
      'document',
      'task-1'
    );
    const mention = runtime.nodes('document-mention')[0];
    expect(mention.props()).toMatchObject({
      blockName: 'task',
      mentionUuid: 'uuid-1',
    });
    expect(runtime.errors).toEqual([]);
  } finally {
    await runtime.close();
  }
});

test('a read-only document opens the composer without linking back', async () => {
  const runtime = mountParagraph('buy milk today.', 4, 8);
  try {
    slot(runtime, false).task.select?.(() => {});
    const params = composer.createPopoverSplit.mock.calls[0][0].content.params;
    expect(params.linkInSource).toBeUndefined();
  } finally {
    await runtime.close();
  }
});

// A resync while the link is queued settles it cancelled: nothing is written,
// the backlink is untracked with Source's failure toast, and the Create More
// chain still links the next task.
test('a resync while the link is queued cancels it and keeps later links working', async () => {
  const runtime = mountParagraph('buy milk today.', 4, 8);
  try {
    const { task } = slot(runtime);
    task.select?.(() => {});
    const params = composer.createPopoverSplit.mock.calls[0][0].content.params;
    const generation = runtime.view.mirror.keyGeneration;
    if (generation === null) throw new Error('Missing view generation');
    const port = runtime.view.port as unknown as {
      inputSettledIfSessionEdit: (...args: unknown[]) => unknown;
    };
    const queue = port.inputSettledIfSessionEdit.bind(port);
    let resynced = false;
    const flip = vi
      .spyOn(port, 'inputSettledIfSessionEdit')
      .mockImplementationOnce((...args: unknown[]) => {
        // The resync lands after the link captured its generation and
        // requested admission, before the queued entry runs.
        vi.spyOn(runtime.view.mirror, 'keyGeneration', 'get').mockReturnValue(
          generation + 1
        );
        resynced = true;
        return queue(...args);
      });
    params.linkInSource.insert({ documentId: 'task-1', title: 'One' });
    await vi.waitFor(() => expect(resynced).toBe(true));
    await vi.waitFor(() =>
      expect(toasts.failure).toHaveBeenCalledWith(
        'Could not link the task in this document'
      )
    );
    expect(composer.untrackMention).toHaveBeenCalledWith(
      'doc-1',
      'uuid-1',
      'document'
    );
    vi.restoreAllMocks();
    flip.mockRestore();
    expect(paragraphText(runtime)).toBe('buy milk today.');
    params.linkInSource.insert({ documentId: 'task-2', title: 'Two' });
    await vi.waitFor(() =>
      expect(paragraphText(runtime)).toBe('buy milk [Two] today.')
    );
  } finally {
    await runtime.close();
  }
});
