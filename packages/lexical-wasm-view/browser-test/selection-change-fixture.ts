import {
  ABI_MAJOR,
  CommandCode,
} from '@macro-inc/collaboration/session/abi.generated';
import init, {
  EditorSession,
} from '../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { mountLocalSessionView } from '../src/local-session-view';
import { createBuiltinRegistry } from '../src/view/node-views/builtins';
import { registerMacroElementViews } from '../src/view/node-views/macro';

await init();
const root = document.getElementById('editor');
if (!root) throw new Error('Missing editor root');
const errors: string[] = [];
const native = await mountLocalSessionView(
  root,
  registerMacroElementViews(createBuiltinRegistry()),
  {
    namespace: 'selection-change-tape',
    theme: {},
    editable: true,
    preset: 'rich',
    onError(error) {
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
      EditorSession.createMacro(ABI_MAJOR, config, now, wall),
  }
);

const selectionChangeTape = {
  errors,
  run() {
    const hydration = (event: Event) => event.stopImmediatePropagation();
    document.addEventListener('selectionchange', hydration, true);
    try {
      root.focus();
      native.port.command(CommandCode.InsertText, 0, 0, '\n𝔸\u2028');
      native.port.command(CommandCode.InsertLineBreak);
      native.port.command(CommandCode.InsertTab);
      native.port.command(CommandCode.InsertText, 0, 0, '👩‍👩‍👧éZ');
      const leaf = [...native.view.mirror.values()].find(
        (node) => node.text === '👩‍👩‍👧éZ'
      );
      if (!leaf) throw new Error('Missing tape text');
      const backward = {
        kind: 'range' as const,
        anchor: { key: leaf.key, offset: 8, type: 'text' as const },
        focus: { key: leaf.key, offset: 6, type: 'text' as const },
      };
      native.port.selectionFromView(backward);
      const element = native.view.getElementByKey(leaf.key);
      if (!element) throw new Error('Missing tape element');
      const text = document
        .createTreeWalker(element, NodeFilter.SHOW_TEXT)
        .nextNode();
      const dom = document.getSelection();
      if (!text || !dom) throw new Error('Missing tape range');
      document.removeEventListener('selectionchange', hydration, true);
      dom.setBaseAndExtent(text, 6, text, 8);
      document.dispatchEvent(new Event('selectionchange'));
      const first = structuredClone(native.view.selection().selection);
      document.dispatchEvent(new Event('selectionchange'));
      return {
        first,
        second: structuredClone(native.view.selection().selection),
        backward,
        dom: { anchor: dom.anchorOffset, focus: dom.focusOffset },
        text: root.textContent,
      };
    } finally {
      document.removeEventListener('selectionchange', hydration, true);
    }
  },
};
Object.assign(window, { selectionChangeTape });
declare global {
  interface Window {
    selectionChangeTape: typeof selectionChangeTape;
  }
}
