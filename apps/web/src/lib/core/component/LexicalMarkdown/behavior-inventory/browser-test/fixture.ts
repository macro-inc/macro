import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import { registerList } from '@lexical/list';
import { $convertToMarkdownString, CODE } from '@lexical/markdown';
import { registerRichText } from '@lexical/rich-text';
import {
  ALL_TRANSFORMERS,
  NodeReplacements,
  ORDERED_LIST_ENTER,
  SupportedNodeTypes,
} from '@macro-inc/lexical-core';
import { HR } from '@macro-inc/lexical-core/transformers/transformers';
import {
  $createParagraphNode,
  $getRoot,
  createEditor,
  type LexicalEditor,
  type SerializedEditorState,
} from 'lexical';
import { customDeletePlugin } from '../../plugins/custom-delete/customDeletePlugin';
import {
  DefaultShortcuts,
  keyboardShortcutsPlugin,
  ListAndQuoteShortcuts,
} from '../../plugins/keyboard-shortcuts/keyboardShortcutsPlugin';
import { markdownPastePlugin } from '../../plugins/markdown-paste/markdownPastePlugin';
import { markdownShortcutsPlugin } from '../../plugins/markdown-shortcuts/markdownShortcutsPlugin';
import { nodeTransformPlugin } from '../../plugins/node-transform/nodeTransformPlugin';
import { singleLinePlugin } from '../../plugins/single-line/singleLinePlugin';
import { tabIndentationPlugin } from '../../plugins/tab-indentation/tabIndentationPlugin';

function element(id: string) {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing fixture element: ${id}`);
  return found;
}

function mount(id: string) {
  const editor = createEditor({
    namespace: `behavior-${id}`,
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
    onError(error) {
      throw error;
    },
  });
  const root = element(id);
  root.contentEditable = 'true';
  // A hand-mounted host must reflect editability, as the production Solid
  // contenteditable binding does. setEditable itself emits the listener only.
  editor.registerEditableListener((editable) => {
    root.contentEditable = String(editable);
    root.setAttribute('aria-readonly', String(!editable));
  });
  editor.setRootElement(root);
  registerRichText(editor);
  registerHistory(editor, createEmptyHistoryState(), 400);
  editor.update(() => $getRoot().append($createParagraphNode()), {
    discrete: true,
  });
  return editor;
}

const TITLE = mount('title');
singleLinePlugin()(TITLE);
const BODY = mount('body');
registerList(BODY);
nodeTransformPlugin()(BODY);
markdownShortcutsPlugin({
  transformers: ALL_TRANSFORMERS,
  triggerOnEnterTransformers: [HR, CODE, ORDERED_LIST_ENTER],
})(BODY);
keyboardShortcutsPlugin({
  shortcuts: [...DefaultShortcuts, ...ListAndQuoteShortcuts],
})(BODY);
markdownPastePlugin()(BODY);
customDeletePlugin()(BODY);
tabIndentationPlugin()(BODY);

function toggleEditable(editor: LexicalEditor, editable: boolean) {
  editor.setEditable(editable);
}
element('readonly').addEventListener('click', () =>
  toggleEditable(BODY, false)
);
element('editable').addEventListener('click', () => toggleEditable(BODY, true));
let saved: SerializedEditorState | undefined;
element('save').addEventListener('click', () => {
  saved = BODY.getEditorState().toJSON();
  const markdown = BODY.read(() => $convertToMarkdownString(ALL_TRANSFORMERS));
  element('saved').textContent = JSON.stringify({
    engine: 'upstream-off',
    state: saved,
    markdown,
  });
});
element('reopen').addEventListener('click', () => {
  if (saved) BODY.setEditorState(BODY.parseEditorState(saved));
});
document.documentElement.dataset.ready = 'true';
