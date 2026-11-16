/**
 * Test-only: a native table surface over the real local session executor, so
 * the hosts' SessionEdit inputs settle (runSettled) and report their own
 * main-commit evidence, as in the app. nativeSurface's minimal executor has
 * neither.
 */
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
import { NOOP_SPAN } from '@macro-inc/observability';

const NAMESPACE = 'native-table-hosts';
let previousLocks: PropertyDescriptor | undefined;

/** beforeAll: the shared lock API and the app's own document-session WASM. */
export function initializeNativeTableTests() {
  previousLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
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
}

/** afterAll: restore the lock API. */
export function restoreNativeTableTests() {
  if (previousLocks) Object.defineProperty(navigator, 'locks', previousLocks);
  else Reflect.deleteProperty(navigator, 'locks');
}

export function nativeTableSurface() {
  const root = document.createElement('div');
  document.body.append(root);
  const errors: unknown[] = [];
  const runtime = mountLocalSessionView(
    root,
    registerMacroElementViews(createBuiltinRegistry()),
    {
      namespace: NAMESPACE,
      theme: {},
      editable: true,
      preset: 'rich',
      parentSpan: NOOP_SPAN,
      onError(error) {
        errors.push(error);
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
          NAMESPACE
        ),
    }
  );
  return {
    view: runtime.view,
    port: runtime.port,
    root,
    errors,
    /** Live session authorization, reaching the session before UI editability. */
    authorize(write: boolean, comment: boolean) {
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
    async close() {
      await runtime.close();
      root.remove();
    },
  };
}
