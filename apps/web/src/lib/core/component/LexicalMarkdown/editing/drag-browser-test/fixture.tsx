import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { UserContextProvider } from '@core/context/user';
import { registerExternalUrlInterceptor } from '@core/util/url';
import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import { $createLinkNode } from '@lexical/link';
import {
  $createListItemNode,
  $createListNode,
  registerList,
} from '@lexical/list';
import { $convertToMarkdownString, CODE } from '@lexical/markdown';
import { registerRichText } from '@lexical/rich-text';
import {
  $createTableNodeWithDimensions,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  $mergeCells,
} from '@lexical/table';
import {
  $createCustomCodeNode,
  $createDocumentMentionNode,
  $createEquationNode,
  $createHorizontalRuleNode,
  ALL_TRANSFORMERS,
  EquationNode,
  HorizontalRuleNode,
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
import { queryClient } from '@queries/client';
import { QueryClientProvider } from '@tanstack/solid-query';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  HISTORY_PUSH_TAG,
  type LexicalEditor,
  type SerializedEditorState,
} from 'lexical';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { DecoratorRenderer } from '../../component/core/DecoratorRenderer';
import { NodeAccessoryRenderer } from '../../component/core/NodeAccessoryRenderer';
import { Equation } from '../../component/decorator/Equation';
import { HorizontalRule } from '../../component/decorator/HorizontalRule';
import { MarkdownImage } from '../../component/decorator/MarkdownImage';
import { ActionMenu } from '../../component/menu/ActionsMenu';
import { EmojiMenu } from '../../component/menu/EmojiMenu';
import { FloatingEquationMenu } from '../../component/menu/FloatingEquationMenu';
import { FloatingFormatMenu } from '../../component/menu/FloatingFormatMenu';
import { FloatingGifMenu } from '../../component/menu/FloatingGifMenu';
import { FloatingLinkMenu } from '../../component/menu/FloatingLinkMenu';
import { FloatingTableMenu } from '../../component/menu/FloatingTableMenu';
import { DraggableBlockMenu } from '../../component/misc/DraggableBlockMenu';
import { DragInsertIndicator } from '../../component/misc/DragInsertIndicator';
import { TableCellResizer } from '../../component/misc/TableCellResizer';
import { TableDeleteButtons } from '../../component/misc/TableDeleteButtons';
import { TableInsertButton } from '../../component/misc/TableInsertButton';
import { TableMoveHandle } from '../../component/misc/TableMoveHandle';
import { TableSelectionActionBar } from '../../component/misc/TableSelectionActionBar';
import { TaskListControlsRenderer } from '../../component/task-list/TaskListControls';
import { FloatingMenuGroup } from '../../context/FloatingMenuContext';
import {
  type LexicalWrapperBase,
  LexicalWrapperContext,
} from '../../context/LexicalWrapperContext';
import { actionsPlugin } from '../../plugins/actions/actionsPlugin';
import { blockDecoratorNavigationPlugin } from '../../plugins/block-decorator-navigation';
import { checklistPlugin } from '../../plugins/checklist/checklistPlugin';
import { createChecklistControls } from '../../plugins/checklist-controls/checklistControlsPlugin';
import { codePlugin } from '../../plugins/code/codePlugin';
import { customDeletePlugin } from '../../plugins/custom-delete/customDeletePlugin';
import {
  createDragInsertStore,
  dragInsertPlugin,
} from '../../plugins/drag-insert/dragInsertPlugin';
import {
  createDraggableBlockStore,
  draggableBlockPlugin,
} from '../../plugins/draggable-block/draggableBlockPlugin';
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
import { restoreFocusPlugin } from '../../plugins/restore-focus/restoreFocusPlugin';
import { selectionDataPlugin } from '../../plugins/selection-data/selectionDataPlugin';
import { singleLinePlugin } from '../../plugins/single-line/singleLinePlugin';
import { tabIndentationPlugin } from '../../plugins/tab-indentation/tabIndentationPlugin';
import { tableCellResizerPlugin } from '../../plugins/tables/tableCellResizerPlugin';
import { tablePlugin } from '../../plugins/tables/tablePlugin';
import { tableTouchSelectionPlugin } from '../../plugins/tables/tableTouchSelection';
import { textPastePlugin } from '../../plugins/text-paste/textPastePlugin';
import { trailingParagraphPlugin } from '../../plugins/trailing-paragraph/trailingParagraphPlugin';
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
const CONTROLS_ENABLED = new URLSearchParams(location.search).has('controls');
const DRAG_ENABLED = new URLSearchParams(location.search).has('drag');
const TABLE_CONTROLS_ENABLED = new URLSearchParams(location.search).has(
  'table-controls'
);
const TABLE_SELECTION_ENABLED = new URLSearchParams(location.search).has(
  'table-selection'
);
const TABLE_ACTIONS_ENABLED = new URLSearchParams(location.search).has(
  'table-actions'
);
const TABLE_MOVE_ENABLED = new URLSearchParams(location.search).has(
  'table-move'
);
const EQUATION_ENABLED = new URLSearchParams(location.search).has('equations');
const LINK_CONTRACTS_ENABLED = new URLSearchParams(location.search).has(
  'link-contracts'
);
if (LINK_CONTRACTS_ENABLED) {
  // Observe the actual URL-launch host boundary, without opening external pages.
  const opened = document.createElement('output');
  opened.id = 'opened-urls';
  opened.textContent = '[]';
  document.body.append(opened);
  const urls: string[] = [];
  registerExternalUrlInterceptor((url) => {
    urls.push(url);
    opened.textContent = JSON.stringify(urls);
    return true;
  });
  const loadLinks = document.createElement('button');
  loadLinks.id = 'load-link-samples';
  loadLinks.textContent = 'Load link samples';
  loadLinks.addEventListener('click', () => {
    BODY.update(
      () => {
        $getRoot()
          .clear()
          .append(
            $createParagraphNode().append(
              $createLinkNode('https://example.com/first').append(
                $createTextNode('First metadata').toggleFormat('bold')
              )
            ),
            $createParagraphNode().append(
              $createLinkNode('https://example.net/second').append(
                $createTextNode('Second metadata')
              )
            ),
            $createParagraphNode().append(
              $createLinkNode('').append($createTextNode('Empty destination'))
            ),
            $createParagraphNode().append($createTextNode('after links'))
          );
      },
      { discrete: true, tag: HISTORY_PUSH_TAG }
    );
  });
  document.body.append(loadLinks);
}
const GIF_ENABLED = new URLSearchParams(location.search).has('gifs');
const TRAILING_ENABLED = new URLSearchParams(location.search).has('trailing');
if (TRAILING_ENABLED) trailingParagraphPlugin()(BODY);
if (EQUATION_ENABLED && new URLSearchParams(location.search).has('readonly')) {
  BODY.setEditable(false);
}
const [DRAG_STATE, setDragState] = createDraggableBlockStore();
if (DRAG_ENABLED)
  draggableBlockPlugin({ setState: setDragState, anchorElem: element('body') })(
    BODY
  );
if (new URLSearchParams(location.search).has('second')) {
  // A second rich editor on the page with the app's drag plugins (block handle and
  // registerMarkdownEditing's drag-insert over a listener container), as two documents
  // open side by side, to observe Source's cross-editor block-handle drop.
  const container = document.createElement('div');
  const host = document.createElement('div');
  host.id = 'second';
  host.setAttribute('role', 'textbox');
  host.setAttribute('aria-label', 'Second');
  host.setAttribute('aria-multiline', 'true');
  container.append(host);
  element('body').after(container);
  const second = mount('second');
  registerList(second);
  const [, setSecondDragState] = createDraggableBlockStore();
  draggableBlockPlugin({ setState: setSecondDragState, anchorElem: host })(
    second
  );
  const [insert, setInsert] = createDragInsertStore();
  dragInsertPlugin({ setState: setInsert, dragListenerRef: container })(second);
  render(
    () => <DragInsertIndicator state={insert} active editor={second} />,
    element('menus')
  );
  second.update(
    () =>
      $getRoot()
        .clear()
        .append($createParagraphNode().append($createTextNode('destination'))),
    { discrete: true }
  );
}
const CHECKLIST_CONTROLS = createChecklistControls();
if (CONTROLS_ENABLED) CHECKLIST_CONTROLS.plugin(BODY);
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
if (EQUATION_ENABLED) setDecorator(EquationNode, Equation);
mediaPlugin()(BODY);
const [ACCESSORIES, setAccessories] = createAccessoryStore();
codePlugin({ accessories: ACCESSORIES, setAccessories })(BODY);
tablePlugin({
  hasCellMerge: true,
  hasCellBackgroundColor: true,
  hasTabHandler: true,
  hasHorizontalScroll: true,
})(BODY);
if (
  TABLE_CONTROLS_ENABLED ||
  TABLE_SELECTION_ENABLED ||
  TABLE_ACTIONS_ENABLED ||
  TABLE_MOVE_ENABLED
) {
  tableCellResizerPlugin()(BODY);
  tableTouchSelectionPlugin()(BODY);
}
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
const FORMAT_CONTRACTS_ENABLED = new URLSearchParams(location.search).has(
  'format-contracts'
);
if (
  new URLSearchParams(location.search).has('clipboard-contracts') ||
  FORMAT_CONTRACTS_ENABLED
) {
  textPastePlugin()(BODY);
}
if (FORMAT_CONTRACTS_ENABLED) restoreFocusPlugin()(BODY);
if (new URLSearchParams(location.search).has('navigation-contracts')) {
  blockDecoratorNavigationPlugin()(BODY);
  setDecorator(HorizontalRuleNode, HorizontalRule);
  const load = document.createElement('button');
  load.textContent = 'Load navigation blocks';
  load.addEventListener('click', () => {
    BODY.update(
      () => {
        $getRoot()
          .clear()
          .append(
            $createParagraphNode().append($createTextNode('alpha')),
            $createHorizontalRuleNode(),
            $createParagraphNode().append($createTextNode('omega'))
          );
      },
      { discrete: true, tag: HISTORY_PUSH_TAG }
    );
  });
  document.body.append(load);
}

if (new URLSearchParams(location.search).has('clipboard-structure')) {
  for (const kind of ['list', 'table', 'rule', 'mixed']) {
    const load = document.createElement('button');
    load.textContent = `Load clipboard ${kind}`;
    load.addEventListener('click', () => {
      BODY.update(
        () => {
          const root = $getRoot().clear();
          root.append($createParagraphNode().append($createTextNode('before')));
          if (kind === 'list' || kind === 'mixed') {
            root.append(
              $createListNode('bullet').append(
                $createListItemNode().append(
                  $createTextNode('first').toggleFormat('bold')
                ),
                $createListItemNode().append($createTextNode('second'))
              )
            );
          }
          if (kind === 'rule' || kind === 'mixed')
            root.append($createHorizontalRuleNode());
          if (kind === 'table' || kind === 'mixed') {
            const table = $createTableNodeWithDimensions(2, 2, false);
            table.getChildren().forEach((row, rowIndex) => {
              if (!$isTableRowNode(row))
                throw new Error('Expected clipboard row');
              row.getChildren().forEach((cell, columnIndex) => {
                if (!$isTableCellNode(cell))
                  throw new Error('Expected clipboard cell');
                cell
                  .clear()
                  .append(
                    $createParagraphNode().append(
                      $createTextNode(
                        `${rowIndex === 0 ? 'A' : 'B'}${columnIndex + 1}`
                      )
                    )
                  );
              });
            });
            root.append(table);
          }
          root.append($createParagraphNode().append($createTextNode('after')));
        },
        { discrete: true, tag: HISTORY_PUSH_TAG }
      );
    });
    document.body.append(load);
  }
}
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
          {LINK_CONTRACTS_ENABLED && <ToastRegion />}
          <ActionMenu
            editor={BODY}
            menu={ACTION_MENU}
            anchor={element('body')}
            portalScope="global"
            ignoreActionIds={[
              'task',
              'document',
              'image',
              ...(GIF_ENABLED ? [] : ['gif']),
              'video',
              ...(EQUATION_ENABLED ? [] : ['latex']),
              'hr',
              'database-query',
              'database',
              'code',
            ]}
          />
          <EmojiMenu editor={BODY} menu={EMOJI_MENU} portalScope="global" />
          <DecoratorRenderer editor={BODY} />
          <NodeAccessoryRenderer editor={BODY} store={ACCESSORIES} />
          {DRAG_ENABLED && (
            <DraggableBlockMenu
              state={DRAG_STATE}
              setState={setDragState}
              active={bodyEditable()}
            />
          )}
          {TABLE_CONTROLS_ENABLED && (
            <Show when={bodyEditable()}>
              <TableCellResizer />
            </Show>
          )}
          {TABLE_ACTIONS_ENABLED && !isTouchDevice() && (
            <Show when={bodyEditable()}>
              <TableInsertButton />
              <TableDeleteButtons />
              <TableCellResizer />
            </Show>
          )}
          {TABLE_MOVE_ENABLED && (
            <Show when={bodyEditable()}>
              {isTouchDevice() ? (
                <TableSelectionActionBar />
              ) : (
                <>
                  <TableInsertButton />
                  <TableDeleteButtons />
                </>
              )}
              <TableCellResizer />
              <TableMoveHandle />
            </Show>
          )}
          {TABLE_SELECTION_ENABLED && isTouchDevice() && (
            <Show when={bodyEditable()}>
              <TableSelectionActionBar />
            </Show>
          )}
          {CONTROLS_ENABLED && (
            <QueryClientProvider client={queryClient}>
              <UserContextProvider>
                <TaskListControlsRenderer
                  editor={BODY}
                  data={CHECKLIST_CONTROLS.data}
                />
              </UserContextProvider>
            </QueryClientProvider>
          )}
          <FloatingMenuGroup>
            {GIF_ENABLED && (
              <FloatingGifMenu canEdit={bodyEditable} portalScope="global" />
            )}
            <FloatingLinkMenu autoLinkMatchMode="common-tlds" />
            {LINK_CONTRACTS_ENABLED && <FloatingFormatMenu />}
            <FloatingTableMenu canEdit={bodyEditable} />
            {EQUATION_ENABLED && (
              <FloatingEquationMenu canEdit={bodyEditable} />
            )}
          </FloatingMenuGroup>
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
function loadTableControls(defaultWidths = false, tall = false) {
  BODY.update(
    () => {
      const table = $createTableNodeWithDimensions(3, 3, false);
      if (!defaultWidths) table.setColWidths([160, 160, 160]);
      table.getChildren().forEach((row, rowIndex) => {
        if (!$isTableRowNode(row)) throw new Error('Expected table row');
        row.setHeight(60);
        row.getChildren().forEach((cell, columnIndex) => {
          if (!$isTableCellNode(cell)) throw new Error('Expected table cell');
          const text = $createTextNode(
            `Cell ${rowIndex + 1}:${columnIndex + 1}`
          );
          if (
            (TABLE_SELECTION_ENABLED || TABLE_MOVE_ENABLED) &&
            rowIndex === 0 &&
            columnIndex === 0
          ) {
            text.setFormat('bold');
          }
          cell.clear().append($createParagraphNode().append(text));
        });
      });
      $getRoot().clear().append(table);
      if (tall) {
        for (let index = 0; index < 20; index++) {
          $getRoot().append(
            $createParagraphNode().append(
              $createTextNode(`Scroll content ${index + 1}`)
            )
          );
        }
      }
    },
    { discrete: true, tag: HISTORY_PUSH_TAG }
  );
}
element('load-table-controls').addEventListener('click', () =>
  loadTableControls()
);
element('load-default-table').addEventListener('click', () =>
  loadTableControls(true)
);
element('load-tall-table').addEventListener('click', () =>
  loadTableControls(false, true)
);
element('load-merged-table').addEventListener('click', () => {
  loadTableControls();
  BODY.update(
    () => {
      const table = $getRoot().getFirstChildOrThrow();
      if (!$isTableNode(table)) throw new Error('Expected table');
      const row = table.getFirstChildOrThrow();
      if (!$isTableRowNode(row)) throw new Error('Expected table row');
      const cells = row.getChildren().filter($isTableCellNode);
      $mergeCells(cells.slice(0, 2));
    },
    { discrete: true, tag: HISTORY_PUSH_TAG }
  );
});
element('load-equation').addEventListener('click', () => {
  BODY.update(
    () => {
      $getRoot()
        .clear()
        .append(
          $createParagraphNode().append(
            $createTextNode('before '),
            $createEquationNode('x+1', true),
            $createTextNode(' after')
          )
        );
    },
    { discrete: true, tag: HISTORY_PUSH_TAG }
  );
});
element('load-drag-blocks').addEventListener('click', () => {
  BODY.update(
    () => {
      $getRoot()
        .clear()
        .append(
          $createParagraphNode().append($createTextNode('Alpha block')),
          $createParagraphNode().append($createTextNode('Bravo block')),
          $createParagraphNode().append($createTextNode('Charlie block'))
        );
    },
    { discrete: true, tag: HISTORY_PUSH_TAG }
  );
});
element('load-drag-list').addEventListener('click', () => {
  BODY.update(
    () => {
      $getRoot()
        .clear()
        .append(
          $createParagraphNode().append($createTextNode('Leading block')),
          $createListNode('check').append(
            $createListItemNode(false).append($createTextNode('First item')),
            $createListItemNode(true).append($createTextNode('Grouped item')),
            $createListItemNode().append(
              $createListNode('bullet').append(
                $createListItemNode().append($createTextNode('Nested child'))
              )
            ),
            $createListItemNode(false).append($createTextNode('Last item'))
          ),
          $createParagraphNode().append($createTextNode('Trailing block'))
        );
    },
    { discrete: true, tag: HISTORY_PUSH_TAG }
  );
});
element('load-checklists').addEventListener('click', () => {
  BODY.update(
    () => {
      $getRoot()
        .clear()
        .append(
          $createListNode('check').append(
            $createListItemNode(true).append(
              $createTextNode('Plain completed')
            ),
            $createListItemNode(false).append($createTextNode('Plain open'))
          ),
          $createParagraphNode(),
          $createListNode('check').append(
            $createListItemNode(false).append(
              $createDocumentMentionNode({
                documentId: 'fixture-open-task',
                documentName: 'Open task',
                blockName: 'task',
              }),
              $createTextNode(' Open row!!')
            ),
            $createListItemNode(true).append(
              $createDocumentMentionNode({
                documentId: 'fixture-done-task',
                documentName: 'Done task',
                blockName: 'task',
              }),
              $createTextNode(' Done row')
            )
          )
        );
    },
    { discrete: true, tag: HISTORY_PUSH_TAG }
  );
});
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
element('load-terminal-code').addEventListener('click', () => {
  BODY.update(
    () => {
      const code = $createCustomCodeNode('javascript');
      code.setCode('javascript', 'const first = 1;');
      $getRoot().clear().append(code);
    },
    { discrete: true, tag: HISTORY_PUSH_TAG }
  );
});
element('load-block-gap').addEventListener('click', () => {
  BODY.update(
    () => {
      const first = $createCustomCodeNode('javascript');
      first.setCode('javascript', 'const first = 1;');
      const second = $createCustomCodeNode('javascript');
      second.setCode('javascript', 'const second = 2;');
      $getRoot().clear().append(first, second);
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
