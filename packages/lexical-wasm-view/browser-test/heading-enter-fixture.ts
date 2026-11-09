import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import { HEADING, registerMarkdownShortcuts } from '@lexical/markdown';
import { HeadingNode, QuoteNode, registerRichText } from '@lexical/rich-text';
import { ABI_MAJOR } from '@macro-inc/collaboration/session/abi.generated';
import {
  $createParagraphNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
} from 'lexical';
import { normalizeEnterPlugin } from '../../../apps/web/src/lib/core/component/LexicalMarkdown/plugins/normalize-enter/normalizeEnterPlugin';
import init, {
  EditorSession,
} from '../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { mountLocalSessionView } from '../src/local-session-view';
import { createBuiltinRegistry } from '../src/view/node-views/builtins';
import { registerMacroElementViews } from '../src/view/node-views/macro';

const errors: string[] = [];
const upstreamRoot = document.getElementById('upstream');
const nativeRoot = document.getElementById('native');
if (!upstreamRoot || !nativeRoot) throw new Error('Missing editor roots');
upstreamRoot.contentEditable = 'true';
const upstream = createEditor({
  namespace: 'input-parity',
  nodes: [HeadingNode, QuoteNode],
  onError: (error) => errors.push(String(error)),
});
upstream.setRootElement(upstreamRoot);
registerRichText(upstream);
registerHistory(upstream, createEmptyHistoryState(), 300);
registerMarkdownShortcuts(upstream, [HEADING]);
normalizeEnterPlugin()(upstream);
upstream.update(() => $getRoot().append($createParagraphNode()), {
  discrete: true,
});
await init();
// Match the app's createMacro + rich view input path. In particular, do not add
// registerNativeNormalizeEnter: the document host does not install that route.
const native = await mountLocalSessionView(
  nativeRoot,
  registerMacroElementViews(createBuiltinRegistry()),
  {
    namespace: 'block-md-main',
    theme: {},
    editable: true,
    preset: 'rich',
    onError: (error) => errors.push(String(error)),
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

function domSelection(root: HTMLElement) {
  const selection = window.getSelection();
  function point(node: Node | null, offset: number) {
    const path: number[] = [];
    while (node && node !== root) {
      const parent = node.parentNode;
      if (!parent) return null;
      path.unshift(Array.from<Node>(parent.childNodes).indexOf(node));
      node = parent;
    }
    return node === root ? { path, offset } : null;
  }
  return {
    anchor: point(selection?.anchorNode ?? null, selection?.anchorOffset ?? 0),
    focus: point(selection?.focusNode ?? null, selection?.focusOffset ?? 0),
  };
}
const inputParity = {
  errors,
  snapshot(engine: 'native' | 'upstream') {
    if (engine === 'native') {
      const selection = native.view.selection().selection;
      const point = (value: { key: number; offset: number; type: string }) => {
        const path: number[] = [];
        let node = native.view.node(value.key);
        while (node && node.parent !== null) {
          const parent = native.view.node(node.parent);
          if (!parent) throw new Error('Missing selection parent');
          path.unshift(parent.children.indexOf(node.key));
          node = parent;
        }
        return { path, offset: value.offset, type: value.type };
      };
      return {
        json: JSON.parse(
          native.port.query({ kind: 7, key: 0, flags: 0, text: '' }).text
        ),
        selection:
          selection.kind === 'range'
            ? { anchor: point(selection.anchor), focus: point(selection.focus) }
            : null,
        domSelection: domSelection(nativeRoot),
        html: nativeRoot.innerHTML,
        markdown: native.executor.session.markdown(1),
      };
    }
    return upstream.getEditorState().read(() => {
      const point = (value: { key: string; offset: number; type: string }) => {
        const path: number[] = [];
        let node = $getNodeByKey(value.key);
        while (node?.getParent()) {
          path.unshift(node.getIndexWithinParent());
          node = node.getParent();
        }
        return { path, offset: value.offset, type: value.type };
      };
      const selection = $getSelection();
      return {
        json: upstream.getEditorState().toJSON(),
        selection: $isRangeSelection(selection)
          ? {
              anchor: point(selection.anchor),
              focus: point(selection.focus),
            }
          : null,
        domSelection: domSelection(upstreamRoot),
        html: upstreamRoot.innerHTML,
      };
    });
  },
};
Object.assign(window, { inputParity });
window.resolveInputParityReady();
declare global {
  interface Window {
    inputParity: typeof inputParity;
    inputParityReady: Promise<void>;
    resolveInputParityReady(): void;
  }
}
