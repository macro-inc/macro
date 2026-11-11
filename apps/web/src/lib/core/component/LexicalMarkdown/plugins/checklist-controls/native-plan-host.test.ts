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
} from '@macro-inc/lexical-wasm-view';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
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

function mount() {
  const root = document.createElement('div');
  document.body.append(root);
  const runtime = mountLocalSessionView(
    root,
    createBuiltinRegistry(),
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

// These controls need only a real ordinary initialized session; they do not
// claim the old module contains the new checklist sidecar producer.
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
