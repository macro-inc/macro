import { createBlockSignal } from '@core/block';
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
import { useCanEdit } from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { mergeRegister } from '@lexical/utils';
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
  onCleanup,
  onMount,
  Show,
  untrack,
} from 'solid-js';
import { blockDataSignal, mdStore } from '../signal/markdownBlockData';
import { useRenameMarkdownDocument } from '../signal/save';

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
        (event: KeyboardEvent) => {
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

  const [showFallback, setShowFallback] = createSignal(true);
  const [titlePlaceholder, _setTitlePlaceholder] = TitlePlaceholderSignal;

  const debouncedRename = debounce(() => {
    const name = state();
    if (canEdit()) renameMarkdownDocument(name);
  }, 500);

  let mountRef!: HTMLDivElement;

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
    trimWhitespace(editor, { trailing: true });
  }

  onMount(() => {
    editor.setRootElement(mountRef);
    mountRef.addEventListener('blur', onBlur);
  });

  onCleanup(() => {
    cleanup();
    mountRef.removeEventListener('blur', onBlur);
  });

  createEffect(() => {
    editor.setEditable(canEdit() ?? false);
  });

  const dataReady = createMemo(() => blockData() !== undefined);

  // Use the empty string as the fallback to show correct empty document state.
  const mdDocumentName = useBlockDocumentName('');

  createEffect(() => {
    const docName = mdDocumentName();
    const _state = untrack(state);
    if (
      dataReady() &&
      docName !== undefined &&
      docName !== _state.trim() &&
      !selfChangedTitle
    ) {
      forceSetTextContent(editor, docName);
    }
    selfChangedTitle = false;
  });

  createEffect(() => {
    if (emojiMenuOperations.isOpen()) return;
    const _state = state();
    if (!untrack(initialized)) {
      setInitialized(true);
      return;
    }
    if (_state.trim() !== untrack(mdDocumentName)) {
      selfChangedTitle = true;
      debouncedRename();
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

  // Autofocus the title if it is empty.
  createEffect(() => {
    if (dataReady()) {
      if (untrack(mdDocumentName) === '') {
        editor.focus();
      }
    }
  });

  // Auto-focus on mount if enabled and title is empty.
  createEffect(() => {
    if (props.autoFocusOnMount && dataReady()) {
      if (untrack(mdDocumentName) === '') {
        editor.focus();
      }
    }
  });

  return (
    <div class="relative">
      <div
        ref={mountRef}
        contentEditable={canEdit() ?? false}
        class="text-4xl font-semibold **:optical-24!"
        classList={{
          'select-auto': !canEdit(),
        }}
      />
      <EmojiMenu
        editor={editor}
        menu={emojiMenuOperations}
        useBlockBoundary={true}
      />
      <Show when={showFallback()}>
        <div class="text-4xl font-semibold optical-32 text-ink-placeholder absolute top-0 pointer-events-none">
          {titlePlaceholder() ?? 'New Note'}
        </div>
      </Show>
    </div>
  );
}
