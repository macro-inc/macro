import { ListItemNode, ListNode } from '@lexical/list';
import { ABI_MAJOR } from '@macro-inc/collaboration/session/abi.generated';
import { TaskListNode } from '@macro-inc/lexical-core';
import { createEditor } from 'lexical';
import { theme } from '../../../apps/web/src/lib/core/component/LexicalMarkdown/theme';
import init, {
  EditorSession,
} from '../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { mountLocalSessionView } from '../src/local-session-view';
import { createBuiltinRegistry } from '../src/view/node-views/builtins';
import { registerMacroElementViews } from '../src/view/node-views/macro';
import seed from './list-item-wrapper.seed.json';

const sourceRoot = document.getElementById('source');
const nativeRoot = document.getElementById('native');
if (!sourceRoot || !nativeRoot) throw new Error('Missing actual editor roots');
const errors: string[] = [];
const source = createEditor({
  namespace: 'list-wrapper-proof',
  nodes: [ListNode, ListItemNode, TaskListNode],
  theme,
  onError: (error) => {
    errors.push(String(error));
  },
});
let native: ReturnType<typeof mountLocalSessionView> | undefined;
let closed = false;
let closing: Promise<void> | undefined;
const close = () => {
  closed = true;
  closing ??= (async () => {
    try {
      source.setRootElement(null);
    } finally {
      await native?.close();
    }
  })();
  return closing;
};
window.listItemWrapperClose = close;
function capture(root: HTMLElement) {
  return {
    dom: root.innerHTML,
    rows: [...root.querySelectorAll('li')].map((row) => ({
      text: row.textContent,
      role: row.getAttribute('role'),
      ariaChecked: row.getAttribute('aria-checked'),
      tabIndex: row.getAttribute('tabindex'),
      className: row.getAttribute('class'),
    })),
  };
}
try {
  source.setRootElement(sourceRoot);
  source.setEditorState(source.parseEditorState(JSON.stringify(seed)));
  await init();
  if (!closed) {
    native = mountLocalSessionView(
      nativeRoot,
      registerMacroElementViews(createBuiltinRegistry()),
      {
        namespace: 'list-wrapper-proof',
        theme,
        editable: true,
        preset: 'rich',
        onError: (error) => {
          errors.push(String(error));
        },
      },
      {
        viewEngine: /Firefox/.test(navigator.userAgent)
          ? 3
          : /AppleWebKit/.test(navigator.userAgent) &&
              !/Chrome/.test(navigator.userAgent)
            ? 2
            : 1,
        viewOs: 0,
        create: (config, now, wall) =>
          EditorSession.createMacroWithNamespace(
            ABI_MAJOR,
            config,
            now,
            wall,
            'list-wrapper-proof'
          ),
      }
    );
    native.port.setState(JSON.stringify(seed));
    window.listItemWrapperProof = {
      capture: () => ({
        source: capture(sourceRoot),
        native: capture(nativeRoot),
        errors: [...errors],
      }),
      close,
    };
  }
} catch (error) {
  await close();
  throw error;
}
declare global {
  interface Window {
    listItemWrapperClose?: () => Promise<void>;
    listItemWrapperProof?: {
      capture(): {
        source: ReturnType<typeof capture>;
        native: ReturnType<typeof capture>;
        errors: string[];
      };
      close(): Promise<void>;
    };
  }
}
