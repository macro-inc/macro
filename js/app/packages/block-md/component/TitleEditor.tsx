import { createBlockSignal, useBlockAliasedName } from '@core/block';
import { EmojiMenu } from '@core/component/LexicalMarkdown/component/menu/EmojiMenu';
import { createLexicalWrapper } from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import {
  autoRegister,
  emojisPlugin,
  singleLinePlugin,
} from '@core/component/LexicalMarkdown/plugins/';
import { createMenuOperations } from '@core/component/LexicalMarkdown/shared/inlineMenu';
import {
  $getCaretRect,
  forceSetTextContent,
  initializeEditorEmpty,
  isRectFlushWith,
  trimWhitespace,
} from '@core/component/LexicalMarkdown/utils';
import { blockNameToDefaultFile } from '@core/constant/allBlocks';
import { useCanEdit } from '@core/signal/permissions';
import { mergeRegister } from '@lexical/utils';
import { onElementConnect } from '@solid-primitives/lifecycle';
import { debounce } from '@solid-primitives/scheduled';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_NORMAL,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  type LexicalEditor,
} from 'lexical';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  Show,
  untrack,
} from 'solid-js';
import { blockDataSignal, mdStore } from '../signal/markdownBlockData';
import { useRenameMarkdownDocument } from '../signal/save';
import { useMarkdownName } from './MarkdownNameProvider';

/**
 * Use the plugin architecture to set up command handlers on both the
 * title editor and the main editor. Pressing enter or the arrows can
 * trigger navigation between the two editors if certain conditions are met.
 * TODO (seamus): Consider making more robust if we get into a situation
 *     where there are three or more editors on one page.
 */
function titleNavigationPlugin(
  documentEditor: LexicalEditor,
  ignoreArrows: Accessor<boolean>
) {
  return (titleEditor: LexicalEditor) =>
    mergeRegister(
      // Press enter in the title editor.
      titleEditor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          if (!event) return false;
          if (ignoreArrows()) return true;
          event?.preventDefault();
          // Prepend a new paragraph to the main editor.
          documentEditor.update(() => {
            const root = $getRoot();
            const firstChild = root.getFirstChild();
            const paragraph = $createParagraphNode();
            paragraph.append($createTextNode(''));
            firstChild
              ? firstChild.insertBefore(paragraph)
              : root.append(paragraph);
            paragraph.selectEnd();
          });
          return true;
        },
        COMMAND_PRIORITY_NORMAL
      ),
      // Press arrow down in the title editor.
      titleEditor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        (event: KeyboardEvent) => {
          if (ignoreArrows()) return true;
          const rect = titleEditor.getRootElement()?.getBoundingClientRect();
          if (!rect) return false;
          const caret = $getCaretRect() ?? rect;
          if (!isRectFlushWith(caret, rect, 'bottom', 5)) return false;

          event?.preventDefault();
          documentEditor.update(() => {
            const root = $getRoot();
            const firstChild = root.getFirstChild();
            firstChild?.selectStart();
          });
          return true;
        },
        COMMAND_PRIORITY_NORMAL
      ),
      // Press right from the end of the title.
      titleEditor.registerCommand(
        KEY_ARROW_RIGHT_COMMAND,
        (event: KeyboardEvent) => {
          if (ignoreArrows()) return true;
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed())
            return false;
          const anchorNode = selection.anchor.getNode();
          const len = anchorNode.getTextContent().length;
          if (selection.anchor.offset !== len) return false;
          if (anchorNode.getParent()?.getLastChild() !== anchorNode)
            return false;

          event?.preventDefault();
          documentEditor.update(() => {
            const root = $getRoot();
            const firstChild = root.getFirstChild();
            firstChild?.selectStart();
          });
          return true;
        },
        COMMAND_PRIORITY_NORMAL
      )
    );
}

export const TitlePlaceholderSignal = createBlockSignal<string | undefined>();

export function TitleEditor(props: { autoFocusOnMount?: boolean } = {}) {
  const mdData = mdStore.get;
  const setMdData = mdStore.set;
  const blockData = blockDataSignal.get;

  const canEdit = useCanEdit();
  const renameMarkdownDocument = useRenameMarkdownDocument();
  const {
    persistedName: persistedDocumentName,
    editorName: mdDocumentName,
    setOptimisticName,
  } = useMarkdownName();

  const [showFallback, setShowFallback] = createSignal(true);
  const [titlePlaceholder, _setTitlePlaceholder] = TitlePlaceholderSignal;
  const [titleFocused, setTitleFocused] = createSignal(false);

  const blockName = useBlockAliasedName();
  const titlePlaceholderFallback = blockNameToDefaultFile(blockName);

  let pendingRename:
    | {
        newName: string;
        oldName: string;
      }
    | undefined;

  const flushPendingRename = () => {
    const next = pendingRename;
    pendingRename = undefined;
    if (!next || !canEdit()) return;
    void renameMarkdownDocument(next.newName, next.oldName);
  };

  const scheduleRename = (newName: string, oldName: string) => {
    if (newName === oldName) return;
    pendingRename = { newName, oldName };
    debouncedFlushRename();
  };

  const debouncedFlushRename = debounce(flushPendingRename, 2000);

  const [state, setState] = createSignal('');
  const [initialized, setInitialized] = createSignal(false);

  const { editor, plugins, cleanup } = createLexicalWrapper({
    namespace: 'block-md-title',
    type: 'title',
    isInteractable: createMemo(() => {
      return canEdit() ?? false;
    }),
  });

  initializeEditorEmpty(editor);

  setMdData('titleEditor', editor);

  const emojiMenuOperations = createMenuOperations();

  plugins
    .plainText()
    .history(400)
    .use(singleLinePlugin())
    .use(
      emojisPlugin({
        menu: emojiMenuOperations,
      })
    )
    .state<string>(setState, 'plain');

  plugins.onUpdate(({ editorState }) => {
    if (!editorState) return;
    const isEmpty = editorState.read(() => {
      return $getRoot().getTextContent() === '';
    });
    setShowFallback(isEmpty);
  });

  let selfChangedTitle = false;

  // Wait for the main editor to be mounted, then register the navigate plugin.
  createEffect(() => {
    const mainDocumentEditor = mdData.editor;
    if (!mainDocumentEditor) return;
    plugins.use(
      titleNavigationPlugin(mainDocumentEditor, () =>
        emojiMenuOperations.isOpen()
      )
    );
  });

  function onBlur() {
    setTitleFocused(false);
    trimWhitespace(editor, { trailing: true });
  }

  const [rootConnected, setRootConnected] = createSignal(false);

  const onConnect = (el: HTMLDivElement) => {
    editor.setRootElement(el);
    const onFocus = () => setTitleFocused(true);
    el.addEventListener('focus', onFocus);
    el.addEventListener('blur', onBlur);
    setRootConnected(true);
    onCleanup(() => {
      debouncedFlushRename.clear();
      flushPendingRename();
      cleanup();
      el.removeEventListener('focus', onFocus);
      el.removeEventListener('blur', onBlur);
    });
  };

  createEffect(() => {
    editor.setEditable(canEdit() ?? false);
  });

  const dataReady = createMemo(() => blockData() !== undefined);

  const hasLocalTitleEdit = createMemo(() => {
    if (!titleFocused()) return false;
    return state().trim() !== (mdDocumentName() ?? '');
  });

  createEffect(
    on(
      () => ({ docName: persistedDocumentName(), ready: dataReady() }),
      ({ docName, ready }) => {
        const currentState = untrack(state);
        if (
          ready &&
          docName !== undefined &&
          docName !== currentState.trim() &&
          !selfChangedTitle &&
          !untrack(hasLocalTitleEdit)
        ) {
          forceSetTextContent(editor, docName);
        }
        selfChangedTitle = false;
      }
    )
  );

  createEffect(() => {
    if (emojiMenuOperations.isOpen()) return;
    const currentState = state();
    if (!untrack(initialized)) {
      setInitialized(true);
      return;
    }
    const nextName = currentState.trim();
    if (nextName !== untrack(mdDocumentName)) {
      setOptimisticName(nextName);
    }
    if (nextName !== (untrack(persistedDocumentName) ?? '')) {
      selfChangedTitle = true;
      if (canEdit()) {
        scheduleRename(nextName, untrack(persistedDocumentName) ?? '');
      }
    }
  });

  createEffect(() => {
    if (mdDocumentName() === persistedDocumentName()) {
      setOptimisticName(undefined);
    }
  });

  autoRegister(
    editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => {
        editor.blur();
        return true;
      },
      COMMAND_PRIORITY_NORMAL
    )
  );

  // Autofocus the title if it is empty and we didn't navigate here via J/K.
  createEffect(() => {
    if (props.autoFocusOnMount && rootConnected() && dataReady()) {
      if (untrack(mdDocumentName) === '') {
        editor.focus();
      }
    }
  });

  return (
    <div class="relative">
      <div
        contentEditable={canEdit() ?? false}
        class="ph-no-capture text-2xl font-semibold"
        classList={{
          'select-auto': !canEdit(),
        }}
        ref={(el) => {
          onElementConnect(el, () => onConnect(el));
        }}
      />
      <EmojiMenu
        editor={editor}
        menu={emojiMenuOperations}
        useBlockBoundary={true}
      />
      <Show when={showFallback()}>
        <div class="text-2xl font-semibold text-ink-placeholder absolute top-0 pointer-events-none">
          {titlePlaceholder() ?? titlePlaceholderFallback}
        </div>
      </Show>
    </div>
  );
}
