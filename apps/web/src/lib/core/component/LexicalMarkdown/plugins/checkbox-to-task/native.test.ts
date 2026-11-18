import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import * as native from '@core/document-session/wasm/document_session_wasm.js';
import { ABI_MAJOR } from '@macro-inc/collaboration/session/abi.generated';
import {
  createBuiltinRegistry,
  mountLocalSessionView,
  registerMacroDecoratorViews,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { NOOP_SPAN } from '@macro-inc/observability';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import {
  convertNativeCheckboxesToTasks,
  registerNativeCheckboxToTaskShortcut,
} from './native';
import type { ParsedCheckbox, TaskCreationResult } from './types';

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
        '../../../../document-session/wasm/document_session_wasm_bg.wasm'
      )
    ),
  });
});
afterAll(() => {
  if (previousLocks) Object.defineProperty(navigator, 'locks', previousLocks);
  else Reflect.deleteProperty(navigator, 'locks');
});
beforeEach(() => API.create.mockReset());

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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

test('converts the selected checklist items with Source parsing and options', async () => {
  API.create.mockResolvedValueOnce('task-1').mockResolvedValueOnce('task-2');
  const runtime = mount(['  First   task  ', 'second']);
  try {
    const complete = deferred<TaskCreationResult[]>();
    expect(
      convertNativeCheckboxesToTasks(
        runtime.view,
        { currentUserId: 'user-1', parentTaskId: 'parent-1' },
        complete.resolve
      )
    ).toBe(true);
    expect(API.create).toHaveBeenCalledTimes(2);
    expect(API.create.mock.calls[0]).toEqual([
      expect.objectContaining({
        title: 'First task',
        assigneeUserIds: [],
        dueDate: null,
        rawMarkdown: expect.stringContaining('First'),
      }),
      { currentUserId: 'user-1', parentTaskId: 'parent-1' },
    ]);
    const results = await complete.promise;
    expect(results.map((result) => result.isOk())).toEqual([true, true]);
    await vi.waitFor(() =>
      expect(
        runtime.nodes('document-mention').map((node) => node.props())
      ).toEqual([
        expect.objectContaining({
          documentId: 'task-1',
          documentName: 'First task',
          blockName: 'task',
        }),
        expect.objectContaining({
          documentId: 'task-2',
          documentName: 'second',
          blockName: 'task',
        }),
      ])
    );
    expect(runtime.nodes('listitem')).toHaveLength(0);
    expect(runtime.errors).toEqual([]);
  } finally {
    await runtime.close();
  }
});

test('failed and empty creations keep their checklist items', async () => {
  API.create
    .mockResolvedValueOnce('created-task')
    .mockResolvedValueOnce(null)
    .mockRejectedValueOnce(new Error('request failed'));
  const runtime = mount(['success', 'empty', 'error']);
  try {
    const complete = deferred<TaskCreationResult[]>();
    convertNativeCheckboxesToTasks(runtime.view, {}, complete.resolve);
    const results = await complete.promise;
    expect(
      results.map((result) => (result.isOk() ? 'ok' : result.error.tag))
    ).toEqual(['ok', 'EmptyCheckbox', 'ApiError']);
    await vi.waitFor(() =>
      expect(runtime.nodes('document-mention')).toHaveLength(1)
    );
    expect(
      runtime.nodes('listitem').map((node) => node.children.length)
    ).toEqual([1, 1]);
  } finally {
    await runtime.close();
  }
});

test('a selection with no checklist item completes empty without creating', async () => {
  const runtime = mount(['item']);
  try {
    runtime.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: [{ type: 'text', version: 1, text: 'plain' }],
            },
          ],
        },
      })
    );
    const text = runtime.nodes('text')[0];
    runtime.port.selectionFromView({
      kind: 'range',
      anchor: { key: text.key, offset: 0, type: 'text' },
      focus: { key: text.key, offset: 5, type: 'text' },
    });
    const complete = vi.fn();
    expect(convertNativeCheckboxesToTasks(runtime.view, {}, complete)).toBe(
      false
    );
    expect(complete).toHaveBeenCalledExactlyOnceWith([]);
    expect(API.create).not.toHaveBeenCalled();
  } finally {
    await runtime.close();
  }
});

test('Mod+Shift+O converts the selection for a signed-in user', async () => {
  API.create.mockResolvedValue('task-1');
  const runtime = mount(['shortcut task']);
  const release = registerNativeCheckboxToTaskShortcut(runtime.view, {
    currentUserId: () => 'user-1',
  });
  try {
    const event = new KeyboardEvent('keydown', {
      key: 'O',
      code: 'KeyO',
      shiftKey: true,
      ctrlKey: true,
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    runtime.view.root.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(API.create).toHaveBeenCalledOnce();
    await vi.waitFor(() =>
      expect(runtime.nodes('document-mention')).toHaveLength(1)
    );
  } finally {
    release();
    await runtime.close();
  }
});

test('Mod+Shift+O without a user is consumed and converts nothing', async () => {
  const runtime = mount(['shortcut task']);
  const release = registerNativeCheckboxToTaskShortcut(runtime.view, {
    currentUserId: () => undefined,
  });
  try {
    const event = new KeyboardEvent('keydown', {
      key: 'O',
      code: 'KeyO',
      shiftKey: true,
      ctrlKey: true,
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    runtime.view.root.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(API.create).not.toHaveBeenCalled();
  } finally {
    release();
    await runtime.close();
  }
});
