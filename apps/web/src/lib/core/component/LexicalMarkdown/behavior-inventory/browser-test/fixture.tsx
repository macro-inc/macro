import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
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
import { render } from 'solid-js/web';
import { ActionMenu } from '../../component/menu/ActionsMenu';
import { EmojiMenu } from '../../component/menu/EmojiMenu';
import { actionsPlugin } from '../../plugins/actions/actionsPlugin';
import { checklistPlugin } from '../../plugins/checklist/checklistPlugin';
import { customDeletePlugin } from '../../plugins/custom-delete/customDeletePlugin';
import { dragInsertPlugin } from '../../plugins/drag-insert/dragInsertPlugin';
import { emojisPlugin } from '../../plugins/emojis/emojisPlugin';
import { filePastePlugin } from '../../plugins/file-paste/filePastePlugin';
import { insertTextPlugin } from '../../plugins/insert-text/insertTextPlugin';
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
import { createMenuOperations } from '../../shared/inlineMenu';
import { theme } from '../../theme';

function element(id: string) {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing fixture element: ${id}`);
  return found;
}

function mount(id: string) {
  const editor = createEditor({
    namespace: `behavior-${id}`,
    theme,
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

document.documentElement.dataset.touchDevice = String(isTouchDevice());
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
checklistPlugin()(BODY);
const ACTION_MENU = createMenuOperations();
actionsPlugin({ menu: ACTION_MENU })(BODY);
const EMOJI_MENU = createMenuOperations();
emojisPlugin({ menu: EMOJI_MENU })(BODY);
insertTextPlugin()(BODY);
filePastePlugin({
  onPasteFilesAndDirs: (files, directories) => {
    element('pasted-files').textContent = JSON.stringify({
      files: files.map((entry) => entry.name),
      directories: directories.map((entry) => entry.name),
    });
  },
})(BODY);
dragInsertPlugin({
  onDrop: (_key, position, event) => {
    element('dropped-files').textContent = JSON.stringify({
      position,
      files: Array.from(event.dataTransfer?.files ?? []).map(
        (file) => file.name
      ),
    });
  },
})(BODY);
render(
  () => (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <ActionMenu
          editor={BODY}
          menu={ACTION_MENU}
          anchor={element('body')}
          portalScope="global"
          ignoreActionIds={[
            'task',
            'document',
            'image',
            'gif',
            'video',
            'link',
            'latex',
            'table',
            'hr',
            'database-query',
            'database',
            'code',
          ]}
        />
        <EmojiMenu editor={BODY} menu={EMOJI_MENU} portalScope="global" />
      </PosthogProvider>
    </AnalyticsContextProvider>
  ),
  element('menus')
);

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

import '@app/index.css';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
