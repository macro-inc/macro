// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import * as native from '@core/document-session/wasm/document_session_wasm.js';
import {
  ABI_MAJOR,
  Access,
} from '@macro-inc/collaboration/session/abi.generated';
import {
  createBuiltinRegistry,
  mountLocalSessionView,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { dispatchApplicationCommandSettledIfSessionEdit } from '../group-b/command';

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
for (const canComment of [false, true])
  test(`reader settings admission is quiet and never enters native (${canComment})`, async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const errors: unknown[] = [];
    const runtime = mountLocalSessionView(
      root,
      registerMacroElementViews(createBuiltinRegistry()),
      {
        namespace: 'reader-admission',
        theme: {},
        editable: true,
        preset: 'rich',
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
            'reader-admission'
          ),
      }
    );
    try {
      runtime.port.setState(
        JSON.stringify({
          root: {
            type: 'root',
            version: 1,
            children: [
              {
                type: 'task-list',
                version: 1,
                listType: 'check',
                start: 1,
                tag: 'ul',
                children: [
                  {
                    type: 'listitem',
                    version: 1,
                    checked: false,
                    value: 1,
                    children: [
                      { type: 'text', version: 1, text: 'Reader row' },
                    ],
                  },
                ],
              },
            ],
          },
        })
      );
      const list = root.querySelector('ul');
      if (!list) throw Error('Missing actual list');
      const key = runtime.view.keyFromDOM(list);
      if (key === null) throw Error('Missing issued list key');
      runtime.executor.run(() =>
        runtime.executor.session.authorization(
          true,
          false,
          canComment,
          runtime.executor.now(),
          Date.now()
        )
      );
      expect(runtime.executor.session.effectiveAccess()).toBe(
        canComment ? Access.CommentOnly : Access.Read
      );
      const input = vi.spyOn(runtime.executor.session, 'input');
      const before = runtime.executor.session.serializedState();
      const payload = vi.fn(() => ({
        action: 'settings',
        key,
        settings: {
          filters: { status: ['done'], priority: [], assignees: [], due: [] },
        },
      }));
      const result = await dispatchApplicationCommandSettledIfSessionEdit(
        runtime.view,
        'group-b.checklist',
        payload
      );
      expect(result).toEqual({ status: 'cancelled', reason: 'session-access' });
      expect(payload).not.toHaveBeenCalled();
      expect(input).not.toHaveBeenCalled();
      expect(errors).toEqual([]);
      expect(runtime.executor.session.serializedState()).toBe(before);
      runtime.executor.run(() =>
        runtime.executor.session.authorization(
          true,
          true,
          false,
          runtime.executor.now(),
          Date.now()
        )
      );
      const granted = await dispatchApplicationCommandSettledIfSessionEdit(
        runtime.view,
        'group-b.checklist',
        payload
      );
      expect(granted.status).toBe('success');
      expect(payload).toHaveBeenCalledOnce();
      expect(runtime.executor.session.serializedState()).toContain(
        '\"status\":[\"done\"]'
      );
    } finally {
      await runtime.close();
      root.remove();
    }
  });

for (const interruption of [
  'queued-retirement',
  'payload-retirement',
  'serialization-retirement',
]) {
  test(`application payload cannot cross ${interruption}`, async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const runtime = mountLocalSessionView(
      root,
      registerMacroElementViews(createBuiltinRegistry()),
      {
        namespace: 'reader-lifetime',
        theme: {},
        editable: true,
        preset: 'rich',
        onError() {},
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
            'reader-lifetime'
          ),
      }
    );
    try {
      const input = vi.spyOn(runtime.executor.session, 'input');
      const payload = vi.fn(() => {
        if (interruption === 'payload-retirement') runtime.view.dispose();
        return {
          get action() {
            if (interruption === 'serialization-retirement')
              runtime.view.dispose();
            return 'settings';
          },
          key: 1,
          settings: {},
        };
      });
      if (interruption === 'queued-retirement') {
        let admission:
          | ReturnType<typeof dispatchApplicationCommandSettledIfSessionEdit>
          | undefined;
        expect(() =>
          runtime.executor.run(() => {
            admission = dispatchApplicationCommandSettledIfSessionEdit(
              runtime.view,
              'group-b.checklist',
              payload
            );
            runtime.view.dispose();
            return runtime.executor.session.tick(
              runtime.executor.now(),
              Date.now()
            );
          })
        ).toThrow('Native view generation changed before admission');
        if (!admission) throw new Error('Missing queued admission');
        const result = await admission;
        expect(result.status).toBe('error');
        expect(payload).not.toHaveBeenCalled();
        expect(input).not.toHaveBeenCalled();
        expect(runtime.view.isMounted).toBe(false);
      } else {
        expect(() =>
          dispatchApplicationCommandSettledIfSessionEdit(
            runtime.view,
            'group-b.checklist',
            payload
          )
        ).toThrow('Native view generation changed during admission');
        expect(payload).toHaveBeenCalledOnce();
        expect(runtime.view.isMounted).toBe(false);
        expect(input).not.toHaveBeenCalled();
      }
    } finally {
      await runtime.close();
      root.remove();
    }
  });
}
