// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import * as native from '@core/document-session/wasm/document_session_wasm.js';
import { $createListItemNode, ListItemNode, ListNode } from '@lexical/list';
import {
  ABI_MAJOR,
  Access,
  SessionInputMsg,
} from '@macro-inc/collaboration/session/abi.generated';
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
import { fireEvent, screen, waitFor } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { $createTextNode, $getRoot, createEditor } from 'lexical';
import { createRoot } from 'solid-js';
import { render } from 'solid-js/web';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { createNativeChecklistPlanHost } from '../../plugins/checklist-controls/native-plan-host';
import { NativeChecklistOverlay } from './NativeTaskListControls';

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

for (const canComment of [false, true]) {
  test(`reader filter changes presentation only and access upgrade restores stored settings (${canComment})`, async () => {
    const source = createEditor({
      namespace: 'reader-settings-source',
      nodes: [TaskListNode, ListNode, ListItemNode, DocumentMentionNode],
      onError(error) {
        throw error;
      },
    });
    source.update(
      () => {
        $getRoot().append(
          new TaskListNode('check').append(
            $createListItemNode(false).append(
              $createTextNode('Work '),
              $createDocumentMentionNode({
                documentId: 'task-reader',
                documentName: 'Reader task',
                blockName: 'task',
              })
            )
          )
        );
      },
      { discrete: true }
    );
    const errors: unknown[] = [];
    const root = document.createElement('div');
    document.body.append(root);
    const container = document.createElement('div');
    document.body.append(container);
    const owned = createRoot((dispose) => {
      const host = createNativeChecklistPlanHost((error) => errors.push(error));
      const runtime = mountLocalSessionView(
        root,
        // Actual registered NodeView; this fixture exercises metadata and filters, not task-card UI.
        registerMacroDecoratorViews(createBuiltinRegistry(), {
          'document-mention': () => null,
        }),
        {
          namespace: 'reader-settings-native',
          theme: {},
          editable: true,
          preset: 'rich',
          onError: (error) => errors.push(error),
        },
        {
          viewEngine: 1,
          viewOs: 0,
          latestPublished: [host.observer],
          nativeCommands: native,
          create: (config, now, wall) =>
            native.EditorSession.createMacroWithNamespace(
              ABI_MAJOR,
              config,
              now,
              wall,
              'reader-settings-native'
            ),
        }
      );
      return { host, runtime, dispose };
    });
    let unmount = () => {};
    const user = userEvent.setup();
    try {
      owned.runtime.port.setState(
        JSON.stringify(source.getEditorState().toJSON())
      );
      const plan = new Promise<void>((resolve) => {
        const off = owned.runtime.view.onPluginEvent(
          'group-b.checklist-plan-updates',
          () => {
            off();
            resolve();
          }
        );
      });
      owned.host.updateFacts({ tasks: {}, names: new Map() });
      owned.host.ready(owned.runtime.view);
      await plan;
      unmount = render(
        () => (
          <NativeChecklistOverlay view={owned.runtime.view} host={owned.host} />
        ),
        container
      );
      const filter = await screen.findByRole('button', {
        name: 'Filter tasks',
      });
      owned.runtime.executor.run(() =>
        owned.runtime.executor.session.authorization(
          true,
          false,
          canComment,
          owned.runtime.executor.now(),
          Date.now()
        )
      );
      owned.runtime.view.setEditable(false);
      expect(owned.runtime.executor.session.effectiveAccess()).toBe(
        canComment ? Access.CommentOnly : Access.Read
      );
      const before = owned.runtime.executor.session.serializedState();
      const observedSequence = owned.host.observedSequence();
      expect(observedSequence).toBeDefined();
      const nativeInput = owned.runtime.executor.session.input.bind(
        owned.runtime.executor.session
      );
      const inputBytes: Uint8Array[] = [];
      vi.spyOn(owned.runtime.executor.session, 'input').mockImplementation(
        (...args) => {
          // Bebop encodes into a shared buffer; retain the actual entry bytes.
          inputBytes.push(args[0].slice());
          return nativeInput(...args);
        }
      );
      const settled = vi.spyOn(owned.runtime.executor, 'runSettled');
      fireEvent.pointerEnter(root.querySelector('ul') ?? root);
      await user.click(filter);
      await user.hover(await screen.findByText('Status', { exact: true }));
      await user.click(await screen.findByText('Not started', { exact: true }));
      await waitFor(() => expect(settled).toHaveBeenCalled());
      const result = settled.mock.results[0];
      if (result.type !== 'return')
        throw new Error('Missing actual executor settlement');
      await result.value;
      const settingsCalls = inputBytes.filter((bytes) => {
        const message = SessionInputMsg.decode(bytes).editor;
        return (
          message.isEditorApplication() &&
          message.value.name === 'group-b.checklist-settings-intent'
        );
      });
      expect(settingsCalls).toHaveLength(1);
      const admitted = SessionInputMsg.decode(settingsCalls[0]).editor;
      if (!admitted.isEditorApplication())
        throw new Error('Missing actual settings intent');
      expect(JSON.parse(admitted.value.json).observedSequence).toBe(
        observedSequence
      );
      expect([...owned.host.plans().values()][0]?.result).toMatchObject({
        kind: 'planned',
        settings: { filters: { status: ['not-started'] } },
      });
      expect(owned.runtime.executor.session.serializedState()).toBe(before);
      expect(errors).toEqual([]);
      owned.runtime.executor.run(() =>
        owned.runtime.executor.session.authorization(
          true,
          true,
          false,
          owned.runtime.executor.now(),
          Date.now()
        )
      );
      owned.runtime.view.setEditable(true);
      expect([...owned.host.plans().values()][0]?.result).toMatchObject({
        kind: 'planned',
        settings: { filters: { status: [] } },
      });
      expect(owned.runtime.executor.session.serializedState()).toBe(before);
      await user.click(await screen.findByText('Not started', { exact: true }));
      await waitFor(() =>
        expect(owned.runtime.executor.session.serializedState()).toContain(
          '"status":["not-started"]'
        )
      );
      expect(errors).toEqual([]);
    } finally {
      unmount();
      owned.host.dispose();
      await owned.runtime.close();
      owned.dispose();
      root.remove();
      container.remove();
    }
  });
}
