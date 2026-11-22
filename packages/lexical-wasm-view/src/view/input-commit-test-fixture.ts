import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import {
  ABI_MAJOR,
  EditorInputMsg,
  SessionInputMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import { emptyInput } from '@macro-inc/collaboration/session/input';
import * as native from '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { mountLocalSessionView } from '../local-session-view';
import {
  type NativeCodeTokenProvider,
  NativeEnterDispatcher,
} from './native-enter';
import { createBuiltinRegistry } from './node-views/builtins';
import { registerMacroElementViews } from './node-views/macro';
import { selectionMessage } from './session-port';

export { native };

export function initializeInputCommitFixture() {
  const previous = Object.getOwnPropertyDescriptor(navigator, 'locks');
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: locks,
  });
  native.initSync({
    module: readFileSync(
      resolve(
        import.meta.dirname,
        '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm_bg.wasm'
      )
    ),
  });
  return () => {
    if (previous) Object.defineProperty(navigator, 'locks', previous);
    else Reflect.deleteProperty(navigator, 'locks');
  };
}

export function mountInputCommitFixture(
  bindCommands = true,
  provider?: NativeCodeTokenProvider
) {
  const root = document.createElement('div');
  document.body.append(root);
  try {
    const fenced = provider
      ? NativeEnterDispatcher.forModule(native).fenceCodeTokenProvider(provider)
      : undefined;
    const runtime = mountLocalSessionView(
      root,
      registerMacroElementViews(createBuiltinRegistry()),
      {
        namespace: 'main-commit-gate',
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
        nativeCommands: bindCommands ? native : undefined,
        create: (config, now, wall) =>
          native.EditorSession.createMacroWithNamespace(
            ABI_MAJOR,
            config,
            now,
            wall,
            'main-commit-gate',
            undefined,
            undefined,
            fenced,
            fenced ? 'main-commit-composed-gate' : undefined
          ),
      }
    );
    return { ...runtime, root };
  } catch (error) {
    root.remove();
    throw error;
  }
}

export type InputCommitFixture = ReturnType<typeof mountInputCommitFixture>;

export async function seedInputCommitFixture(runtime: InputCommitFixture) {
  runtime.port.setState(
    JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [
          {
            type: 'paragraph',
            version: 1,
            children: [{ type: 'text', version: 1, text: 'commit' }],
          },
        ],
      },
    })
  );
  const paragraph = runtime.view.mirror.node(0)?.children[0];
  const text =
    paragraph === undefined
      ? undefined
      : runtime.view.mirror.node(paragraph)?.children[0];
  if (text === undefined) throw new Error('Missing actual imported text');
  const settled = await runtime.port.inputSettled(
    EditorInputMsg.fromEditorSelection({
      selection: selectionMessage({
        kind: 'range',
        anchor: { key: text, type: 'text', offset: 0 },
        focus: { key: text, type: 'text', offset: 6 },
      }),
      change: {},
    })
  );
  if (settled.status !== 'success')
    throw new Error('Actual selection did not settle');
}

export function commitApplication(
  runtime: InputCommitFixture,
  json = '"bold"'
) {
  const generation = runtime.view.mirror.keyGeneration;
  if (generation === null) throw new Error('Missing actual generation');
  return {
    name: 'group-b.format-text',
    json,
    generation,
    selection: selectionMessage({ kind: 'keep' }),
  };
}

export function encodedCommitApplication(runtime: InputCommitFixture) {
  return SessionInputMsg.encode({
    ...emptyInput(2),
    editor: EditorInputMsg.fromEditorApplication({
      ...commitApplication(runtime),
      keyboard: false,
      key: '',
      mods: 0,
      code: 0,
    }),
  }).slice();
}

/** Genuine rejected-family native entry: valid correlation, no fabricated flags. */
export function rejectedInputCommitAttempt(
  runtime: InputCommitFixture,
  id: string
) {
  const before = runtime.executor.session.serializedState();
  let thrown: { error: unknown } | undefined;
  try {
    runtime.executor.session.inputObserved(
      SessionInputMsg.encode(emptyInput(4)).slice(),
      runtime.executor.now(),
      Date.now(),
      id
    );
  } catch (error) {
    thrown = { error };
  }
  if (!thrown)
    throw new Error('Actual unsupported observed family did not throw');
  if (runtime.executor.session.serializedState() !== before)
    throw new Error('Rejected observed family changed the actual document');
  return thrown;
}
