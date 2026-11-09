import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import { registerList } from '@lexical/list';
import { $convertToMarkdownString, CODE } from '@lexical/markdown';
import { registerRichText } from '@lexical/rich-text';
import {
  $createCustomCodeNode,
  ALL_TRANSFORMERS,
  NodeReplacements,
  ORDERED_LIST_ENTER,
  SupportedNodeTypes,
} from '@macro-inc/lexical-core';
import { setDecorator } from '@macro-inc/lexical-core/decoratorRegistry';
import {
  $createImageNode,
  ImageNode,
} from '@macro-inc/lexical-core/nodes/ImageNode';
import { HR } from '@macro-inc/lexical-core/transformers/transformers';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  HISTORY_PUSH_TAG,
  type LexicalEditor,
  type SerializedEditorState,
} from 'lexical';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { DecoratorRenderer } from '../../component/core/DecoratorRenderer';
import { NodeAccessoryRenderer } from '../../component/core/NodeAccessoryRenderer';
import { MarkdownImage } from '../../component/decorator/MarkdownImage';
import { ActionMenu } from '../../component/menu/ActionsMenu';
import { EmojiMenu } from '../../component/menu/EmojiMenu';
import {
  type LexicalWrapperBase,
  LexicalWrapperContext,
} from '../../context/LexicalWrapperContext';
import { actionsPlugin } from '../../plugins/actions/actionsPlugin';
import { checklistPlugin } from '../../plugins/checklist/checklistPlugin';
import { codePlugin } from '../../plugins/code/codePlugin';
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
import { mediaPlugin } from '../../plugins/media/mediaPlugin';
import { createAccessoryStore } from '../../plugins/node-accessory/nodeAccessoryPlugin';
import { nodeTransformPlugin } from '../../plugins/node-transform/nodeTransformPlugin';
import { createPluginManager } from '../../plugins/pluginManager';
import { selectionDataPlugin } from '../../plugins/selection-data/selectionDataPlugin';
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
const [bodyEditable, setBodyEditable] = createSignal(BODY.isEditable());
BODY.registerEditableListener(setBodyEditable);
const BODY_WRAPPER: LexicalWrapperBase = {
  type: 'markdown',
  owner: null,
  editor: BODY,
  isInteractable: bodyEditable,
  plugins: createPluginManager(BODY, 'markdown'),
  cleanup: () => BODY_WRAPPER.plugins.cleanup(),
};
BODY_WRAPPER.plugins.use(selectionDataPlugin(BODY_WRAPPER));
setDecorator(ImageNode, MarkdownImage);
mediaPlugin()(BODY);
const [ACCESSORIES, setAccessories] = createAccessoryStore();
codePlugin({ accessories: ACCESSORIES, setAccessories })(BODY);
BODY.registerUpdateListener(({ editorState }) => {
  element('live-state').textContent = JSON.stringify(editorState.toJSON());
});
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
        <LexicalWrapperContext.Provider value={BODY_WRAPPER}>
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
          <DecoratorRenderer editor={BODY} />
          <NodeAccessoryRenderer editor={BODY} store={ACCESSORIES} />
        </LexicalWrapperContext.Provider>
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
element('load-image').addEventListener('click', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#4882b8"/></svg>';
  BODY.update(
    () => {
      $getRoot()
        .clear()
        .append(
          $createImageNode({
            srcType: 'url',
            id: 'fixture-image',
            url: `data:image/svg+xml,${encodeURIComponent(svg)}`,
            alt: 'Fixture image',
            width: 200,
            height: 100,
            scale: 1,
          }),
          $createParagraphNode().append($createTextNode('after'))
        );
    },
    { discrete: true, tag: HISTORY_PUSH_TAG }
  );
});
element('load-code').addEventListener('click', () => {
  BODY.update(
    () => {
      const code = $createCustomCodeNode('javascript');
      code.setCode('javascript', 'const value = 7;');
      $getRoot()
        .clear()
        .append(code, $createParagraphNode().append($createTextNode('after')));
    },
    { discrete: true, tag: HISTORY_PUSH_TAG }
  );
});
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
