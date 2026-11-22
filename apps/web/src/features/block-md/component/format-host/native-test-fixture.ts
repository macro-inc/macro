import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import { ABI_MAJOR } from '@macro-inc/collaboration/session/abi.generated';
import {
  createBuiltinRegistry,
  type LatestPublishedObserver,
  mountLocalSessionView,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import type { ViewSelection } from '@macro-inc/lexical-wasm-view/view/types';
import { afterAll, beforeAll } from 'vitest';
import * as native from '../../../../lib/core/document-session/wasm/document_session_wasm.js';

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

export function mount(
  latestPublished?: readonly LatestPublishedObserver[],
  commands = true
) {
  const root = document.createElement('div');
  document.body.append(root);
  const runtime = mountLocalSessionView(
    root,
    registerMacroElementViews(createBuiltinRegistry()),
    {
      namespace: 'formatting-actions',
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
      nativeCommands: commands ? native : undefined,
      latestPublished,
      create: (config, now, wall) =>
        native.EditorSession.createMacroWithNamespace(
          ABI_MAJOR,
          config,
          now,
          wall,
          'formatting-actions'
        ),
    }
  );
  return { ...runtime, root };
}

export function state(text: string) {
  return JSON.stringify({
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
  });
}

export function select(
  runtime: ReturnType<typeof mount>,
  text: string
): ViewSelection {
  const node = [...runtime.view.mirror.values()].find(
    (node) => node.kind === 'text' && node.text === text
  );
  if (!node) throw new Error('Missing actual native text');
  const selection: ViewSelection = {
    kind: 'range',
    anchor: { key: node.key, offset: 0, type: 'text' },
    focus: { key: node.key, offset: text.length, type: 'text' },
  };
  runtime.port.selectionFromView(selection);
  return selection;
}
