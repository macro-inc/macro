// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import * as native from '@core/document-session/wasm/document_session_wasm.js';
import { $createListItemNode, ListItemNode, ListNode } from '@lexical/list';
import { ABI_MAJOR } from '@macro-inc/collaboration/session/abi.generated';
import {
  $createDocumentMentionNode,
  DocumentMentionNode,
  TaskListNode,
} from '@macro-inc/lexical-core';
import {
  createBuiltinRegistry,
  mountLocalSessionView,
} from '@macro-inc/lexical-wasm-view';
import { registerMacroDecoratorViews } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import { selectionMessage } from '@macro-inc/lexical-wasm-view/view/session-port';
import { PROPERTY_OPTION_IDS } from '@property/constants';
import { $createTextNode, $getRoot, createEditor } from 'lexical';
import { createRoot, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { installNativeMarkdownOverlays } from '../../editing/installNativeMarkdownOverlays';
import { $collectChecklistMeta } from './collect';
import {
  effectiveItem,
  normalizeSettings,
  planChecklist,
  type TaskInfo,
} from './model';
import { createNativeChecklistPlanHost } from './native-plan-host';

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

function mount(host?: ReturnType<typeof createNativeChecklistPlanHost>) {
  const root = document.createElement('div');
  document.body.append(root);
  const runtime = mountLocalSessionView(
    root,
    // Metadata controls use the real decorator NodeView; its app UI is outside this fixture.
    registerMacroDecoratorViews(createBuiltinRegistry(), {
      'document-mention': () => null,
    }),
    {
      namespace: 'checklist-host-lifetime',
      theme: {},
      editable: true,
      preset: 'rich',
      onError(error) {
        throw error;
      },
    },
    {
      viewEngine: 1,
      viewOs: 0,
      nativeCommands: native,
      latestPublished: host ? [host.observer] : undefined,
      create: (config, now, wall) =>
        native.EditorSession.createMacroWithNamespace(
          ABI_MAJOR,
          config,
          now,
          wall,
          'checklist-host-lifetime'
        ),
    }
  );
  return { ...runtime, root };
}

// Ownership controls exercise real ordinary initialized sessions. The refresh
// control additionally requires the matching native checklist sidecar producer.
test('a visual remount reuses its session host and a replacement host is rejected loudly', async () => {
  const runtime = mount();
  const errors: unknown[] = [];
  const host = createNativeChecklistPlanHost((error) => errors.push(error));
  const replacement = createNativeChecklistPlanHost((error) =>
    errors.push(error)
  );
  try {
    host.observer.published(runtime.view);
    host.ready(runtime.view);
    host.ready(runtime.view);
    expect(errors).toEqual([]);
    replacement.ready(runtime.view);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect(String(errors[0])).toContain('session already has a host');
    host.dispose();
    const afterDispose = createNativeChecklistPlanHost((error) =>
      errors.push(error)
    );
    afterDispose.ready(runtime.view);
    expect(errors).toHaveLength(2);
    expect(runtime.view.isMounted).toBe(true);
  } finally {
    host.dispose();
    replacement.dispose();
    await runtime.close();
    runtime.root.remove();
  }
});

test('task deletion and renamed task/contact facts keep the native plan consistent with Source', async () => {
  const source = createEditor({
    namespace: 'checklist-provider-source',
    nodes: [TaskListNode, ListNode, ListItemNode, DocumentMentionNode],
    onError(error) {
      throw error;
    },
  });
  let mention: DocumentMentionNode | undefined;
  source.update(
    () => {
      mention = $createDocumentMentionNode({
        documentId: 'task-a',
        documentName: 'Initial task',
        blockName: 'task',
      });
      $getRoot().append(
        new TaskListNode('check').append(
          $createListItemNode(false).append($createTextNode('Work '), mention)
        )
      );
    },
    { discrete: true }
  );
  const errors: unknown[] = [];
  const { host, runtime, dispose } = createRoot((dispose) => {
    const host = createNativeChecklistPlanHost((error) => errors.push(error));
    return { host, runtime: mount(host), dispose };
  });
  const tasks: Record<string, TaskInfo> = {
    'task-a': {
      statusOptionId: PROPERTY_OPTION_IDS.STATUS.COMPLETED,
      priorityOptionId: null,
      assigneeIds: ['assignee-a'],
      due: null,
    },
  };
  function assertSource(expectedTasks: Record<string, TaskInfo>) {
    const meta = source.read(() => Object.values($collectChecklistMeta())[0]);
    const expected = planChecklist(
      meta.items.map((item) =>
        effectiveItem(
          item,
          item.taskId ? expectedTasks[item.taskId] : undefined,
          () => 'Original name'
        )
      ),
      normalizeSettings(meta.settings),
      new Date()
    );
    const actual = [...host.plans().values()][0]?.result;
    if (actual?.kind !== 'planned')
      throw new Error('Missing actual native checklist plan');
    expect(actual.progress).toMatchObject(expected.progress);
    expect(actual.rows.map((row) => row.dimmed)).toEqual(
      expected.rows.map((row) => row.dimmed)
    );
    return actual;
  }
  function generation() {
    const current = runtime.view.mirror.keyGeneration;
    if (current === null) throw new Error('Missing actual generation');
    return current;
  }
  function nextPlan() {
    return new Promise<void>((resolve) => {
      const release = runtime.view.onPluginEvent(
        'group-b.checklist-plan-updates',
        () => {
          release();
          resolve();
        }
      );
    });
  }
  try {
    runtime.port.setState(JSON.stringify(source.getEditorState().toJSON()));
    const initial = nextPlan();
    host.updateFacts({
      tasks,
      names: new Map([['assignee-a', 'Original name']]),
    });
    host.ready(runtime.view);
    await initial;
    expect(assertSource(tasks).progress.done).toBe(1);
    expect(host.taskIds()).toEqual(['task-a']);
    const renamed = nextPlan();
    host.updateFacts({
      tasks,
      names: new Map([['assignee-a', 'Renamed contact']]),
    });
    await renamed;
    expect(assertSource(tasks).items[0].assignees[0].name).toBe(
      'Renamed contact'
    );
    const node = [...runtime.view.mirror.values()].find(
      (value) => value.type === 'document-mention'
    );
    if (!node || !mention) throw new Error('Missing actual task mention');
    const actualMention = mention;
    source.update(() => actualMention.setDocumentName('Renamed task'), {
      discrete: true,
    });
    const result = await runtime.port.inputSettled(() => ({
      name: 'group-b.document-names',
      json: JSON.stringify({ names: { 'task-a': 'Renamed task' } }),
      generation: generation(),
      selection: selectionMessage({ kind: 'keep' }),
    }));
    expect(result).toEqual({ status: 'success', handled: true });
    expect(runtime.view.node(node.key)?.props().documentName).toBe(
      'Renamed task'
    );
    expect(assertSource(tasks).progress.done).toBe(1);
    const deleted = nextPlan();
    host.updateFacts({ tasks: {}, names: new Map() });
    await deleted;
    expect(assertSource({}).progress.done).toBe(0);
    const removed = nextPlan();
    source.update(() => actualMention.remove(), { discrete: true });
    const removal = await runtime.port.inputSettled(() => ({
      name: 'group-b.document-mention',
      json: JSON.stringify({ action: 'remove', key: node.key }),
      generation: generation(),
      selection: selectionMessage({ kind: 'keep' }),
    }));
    expect(removal).toEqual({ status: 'success', handled: true });
    await removed;
    expect(host.taskIds()).toEqual([]);
    expect(assertSource({}).hasTasks).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    host.dispose();
    await runtime.close();
    runtime.root.remove();
    dispose();
  }
});

test('optional cleanup failure releases every actual registration and cannot escape retirement', async () => {
  const runtime = mount();
  const cause = { cleanup: 'failure' };
  const errors: unknown[] = [];
  const released: string[] = [];
  const plugin = runtime.view.onPluginEvent.bind(runtime.view);
  const mutation = runtime.view.onMutations.bind(runtime.view);
  const pluginSpy = vi
    .spyOn(runtime.view, 'onPluginEvent')
    .mockImplementation((...args) => {
      const cleanup = plugin(...args);
      return () => {
        cleanup();
        released.push('plugin');
        throw cause;
      };
    });
  const mutationSpy = vi
    .spyOn(runtime.view, 'onMutations')
    .mockImplementation((...args) => {
      const cleanup = mutation(...args);
      return () => {
        cleanup();
        released.push('mutation');
      };
    });
  const host = createNativeChecklistPlanHost((error) => {
    errors.push(error);
    throw undefined;
  });
  try {
    host.observer.published(runtime.view);
    expect(() => host.dispose()).not.toThrow();
    host.dispose();
    expect(released).toEqual(['mutation', 'plugin']);
    expect(errors).toEqual([cause]);
    expect(host.plans().size).toBe(0);
    expect(host.taskIds()).toEqual([]);
    expect(runtime.view.isMounted).toBe(true);
  } finally {
    host.dispose();
    pluginSpy.mockRestore();
    mutationSpy.mockRestore();
    await runtime.close();
    runtime.root.remove();
  }
});

test('optional installer disposal unmounts its actual Solid subtree exactly once', async () => {
  const runtime = mount();
  let releases = 0;
  const installation = installNativeMarkdownOverlays(runtime.view, {
    canEdit: () => true,
    checklist() {
      onCleanup(() => {
        releases++;
      });
      return document.createTextNode('checklist overlay');
    },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const unmount = render(() => installation.Overlays?.({}), container);
  try {
    expect(container.textContent).toBe('checklist overlay');
    installation.dispose();
    expect(container.textContent).toBe('');
    expect(releases).toBe(1);
    installation.dispose();
    expect(releases).toBe(1);
  } finally {
    installation.dispose();
    unmount();
    container.remove();
    await runtime.close();
    runtime.root.remove();
  }
});
