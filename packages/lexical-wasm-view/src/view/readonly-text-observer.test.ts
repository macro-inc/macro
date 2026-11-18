/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import {
  ABI_MAJOR,
  Access,
} from '@macro-inc/collaboration/session/abi.generated';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import * as native from '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { mountLocalSessionView } from '../local-session-view';
import { textLeaf } from './dom';
import { createBuiltinRegistry } from './node-views/builtins';
import { registerMacroElementViews } from './node-views/macro';

const locksDescriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
beforeAll(() => {
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
});
afterAll(() => {
  if (locksDescriptor)
    Object.defineProperty(navigator, 'locks', locksDescriptor);
  else Reflect.deleteProperty(navigator, 'locks');
});

function mount() {
  const root = document.createElement('div');
  document.body.append(root);
  const errors: unknown[] = [];
  const runtime = mountLocalSessionView(
    root,
    registerMacroElementViews(createBuiltinRegistry()),
    {
      namespace: 'readonly-observer',
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
          'readonly-observer'
        ),
    }
  );
  runtime.port.setState(
    JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        format: '',
        indent: 0,
        direction: null,
        children: [
          {
            type: 'paragraph',
            version: 1,
            format: '',
            indent: 0,
            direction: null,
            children: [
              {
                type: 'text',
                version: 1,
                text: 'Original text.',
                format: 1,
                mode: 'normal',
                detail: 0,
                style: '',
              },
            ],
          },
        ],
      },
    })
  );
  const node = [...runtime.view.mirror.values()].find(
    (value) => value.kind === 'text'
  );
  if (!node) throw new Error('Missing real native text');
  const leaf = textLeaf(runtime.view.getElementByKey(node.key));
  if (!(leaf instanceof Text)) throw new Error('Missing canonical text leaf');
  return { ...runtime, root, errors, leaf };
}

/** Finish after the actual mutation delivery, including the view's synchronous repair. */
function changeText(root: HTMLElement, leaf: Text) {
  return new Promise<void>((resolve) => {
    const observer = new MutationObserver(() => {
      observer.disconnect();
      queueMicrotask(resolve);
    });
    observer.observe(root, { characterData: true, subtree: true });
    leaf.nodeValue = 'Outside translation.';
    leaf.nodeValue = 'Outside replacement.';
  });
}

for (const access of [Access.Read, Access.CommentOnly]) {
  test(`outside text mutation repairs the canonical leaf under native authority ${access}`, async () => {
    const runtime = mount();
    try {
      runtime.executor.run(() =>
        runtime.executor.session.authorization(
          true,
          false,
          access === Access.CommentOnly,
          runtime.executor.now(),
          Date.now()
        )
      );
      runtime.view.setEditable(false);
      expect(runtime.port.effectiveAccess()).toBe(access);
      const before = runtime.view.query.serializedState();
      const html = runtime.root.innerHTML;
      const text = vi.spyOn(runtime.port, 'textFromView');
      await changeText(runtime.root, runtime.leaf);
      expect(runtime.leaf.nodeValue).toBe('Original text.');
      expect(text).not.toHaveBeenCalled();
      expect(runtime.root.innerHTML).toBe(html);
      expect(runtime.view.query.serializedState()).toBe(before);
      expect(runtime.view.isMounted).toBe(true);
      expect(runtime.errors).toEqual([]);
    } finally {
      await runtime.close();
      runtime.root.remove();
    }
  });
}

test('a local readonly view repairs text even while native authority permits edits', async () => {
  const runtime = mount();
  try {
    runtime.view.setEditable(false);
    expect(runtime.port.effectiveAccess()).toBe(Access.Edit);
    const before = runtime.view.query.serializedState();
    const text = vi.spyOn(runtime.port, 'textFromView');
    await changeText(runtime.root, runtime.leaf);
    expect(runtime.leaf.nodeValue).toBe('Original text.');
    expect(text).not.toHaveBeenCalled();
    expect(runtime.view.query.serializedState()).toBe(before);
    expect(runtime.errors).toEqual([]);
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('an editable view still admits mutation-only text changes exactly once', async () => {
  const runtime = mount();
  try {
    const text = vi.spyOn(runtime.port, 'textFromView');
    await changeText(runtime.root, runtime.leaf);
    expect(text).toHaveBeenCalledTimes(1);
    expect(runtime.leaf.nodeValue).toBe('Outside replacement.');
    expect(runtime.view.query.serializedState()).toContain(
      'Outside replacement.'
    );
    expect(runtime.view.isMounted).toBe(true);
    expect(runtime.errors).toEqual([]);
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});
