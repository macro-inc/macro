import {
  ABI_MAJOR,
  Access,
} from '@macro-inc/collaboration/session/abi.generated';
import init, * as native from '../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { mountLocalSessionView } from '../src/local-session-view';
import { textLeaf } from '../src/view/dom';
import { createBuiltinRegistry } from '../src/view/node-views/builtins';
import { registerMacroElementViews } from '../src/view/node-views/macro';

await init();
const element = document.getElementById('editor');
if (!element) throw new Error('Missing actual editor root');
const root = element;

async function run(mode: 'read' | 'comment' | 'ui' | 'edit') {
  const errors: string[] = [];
  const runtime = mountLocalSessionView(
    root,
    registerMacroElementViews(createBuiltinRegistry()),
    {
      namespace: 'readonly-text-browser',
      theme: {},
      editable: true,
      preset: 'rich',
      onError: (error) => errors.push(String(error)),
    },
    {
      nativeCommands: native,
      viewEngine: /Firefox/.test(navigator.userAgent)
        ? 3
        : /Chrome/.test(navigator.userAgent)
          ? 1
          : 2,
      viewOs: 0,
      create: (config, now, wall) =>
        native.EditorSession.createMacroWithNamespace(
          ABI_MAJOR,
          config,
          now,
          wall,
          'readonly-text-browser'
        ),
    }
  );
  try {
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
    if (mode === 'read' || mode === 'comment')
      runtime.executor.run(() =>
        runtime.executor.session.authorization(
          true,
          false,
          mode === 'comment',
          runtime.executor.now(),
          Date.now()
        )
      );
    runtime.view.setEditable(mode === 'edit');
    const node = [...runtime.view.mirror.values()].find(
      (value) => value.kind === 'text'
    );
    if (!node) throw new Error('Missing actual native text');
    const leaf = textLeaf(runtime.view.getElementByKey(node.key));
    if (!(leaf instanceof Text)) throw new Error('Missing canonical text leaf');
    let submissions = 0;
    const original = runtime.port.textFromView;
    runtime.port.textFromView = (...args) => {
      submissions++;
      return original.apply(runtime.port, args);
    };
    const before = {
      json: runtime.view.query.serializedState(),
      html: root.innerHTML,
    };
    await new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        observer.disconnect();
        queueMicrotask(resolve);
      });
      observer.observe(root, { characterData: true, subtree: true });
      leaf.nodeValue = 'Outside translation.';
      leaf.nodeValue = 'Outside replacement.';
    });
    return {
      mode,
      before,
      after: {
        json: runtime.view.query.serializedState(),
        html: root.innerHTML,
      },
      submissions,
      text: leaf.nodeValue,
      canonicalIdentity:
        leaf === textLeaf(runtime.view.getElementByKey(node.key)),
      editable: runtime.view.isEditable,
      editAuthority: runtime.port.effectiveAccess() === Access.Edit,
      mounted: runtime.view.isMounted,
      errors,
    };
  } finally {
    await runtime.close();
  }
}
declare global {
  interface Window {
    readonlyText: { run: typeof run };
  }
}
window.readonlyText = { run };
