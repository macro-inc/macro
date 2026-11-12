// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import * as native from '@core/document-session/wasm/document_session_wasm.js';
import { ABI_MAJOR } from '@macro-inc/collaboration/session/abi.generated';
import {
  createBuiltinRegistry,
  mountLocalSessionView,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { dispatchNativeChecklistSettings } from './native-checklist-intent';

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

// These are actual mounted-session lifetime negatives on the sealed base module.
// They never send the new intent to that old module and do not prove its support.
for (const interruption of ['target', 'serialization', 'queued']) {
  test(`metadata settings never enter native after ${interruption} retirement`, async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const runtime = mountLocalSessionView(
      root,
      registerMacroElementViews(createBuiltinRegistry()),
      {
        namespace: 'checklist-intent-lifetime',
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
            'checklist-intent-lifetime'
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
                    children: [{ type: 'text', version: 1, text: 'Work' }],
                  },
                ],
              },
            ],
          },
        })
      );
      const list = root.querySelector('ul');
      if (!list) throw new Error('Missing actual checklist');
      const key = runtime.view.keyFromDOM(list);
      if (key === null) throw new Error('Missing issued list key');
      const input = vi.spyOn(runtime.executor.session, 'input');
      const target = vi.fn(() => {
        if (interruption === 'target') runtime.view.dispose();
      });
      const settings = {
        get filters() {
          if (interruption === 'serialization') runtime.view.dispose();
          return { status: ['done'], priority: [], assignees: [], due: [] };
        },
      };
      if (interruption === 'queued') {
        let admission:
          | ReturnType<typeof dispatchNativeChecklistSettings>
          | undefined;
        expect(() =>
          runtime.executor.run(() => {
            admission = dispatchNativeChecklistSettings(
              runtime.view,
              key,
              '1',
              settings,
              target
            );
            runtime.view.dispose();
            return runtime.executor.session.tick(
              runtime.executor.now(),
              Date.now()
            );
          })
        ).toThrow('Checklist settings view changed before admission');
        if (!admission) throw new Error('Missing queued admission');
        expect((await admission).status).toBe('error');
      } else {
        expect(() =>
          dispatchNativeChecklistSettings(
            runtime.view,
            key,
            '1',
            settings,
            target
          )
        ).toThrow('Checklist settings view changed during serialization');
      }
      expect(input).not.toHaveBeenCalled();
      expect(runtime.view.isMounted).toBe(false);
    } finally {
      await runtime.close();
      root.remove();
    }
  });
}
