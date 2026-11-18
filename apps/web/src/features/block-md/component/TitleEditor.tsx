import { activeElement } from '@app/signal/focus';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { EmojiMenu } from '@core/component/LexicalMarkdown/component/menu/EmojiMenu';
import { TagsMenu } from '@core/component/LexicalMarkdown/component/menu/TagsMenu';
import { createLexicalWrapper } from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import {
  autoRegister,
  emojisPlugin,
  singleLinePlugin,
  tagsPlugin,
} from '@core/component/LexicalMarkdown/plugins/';
import { $selectDocumentStart } from '@core/component/LexicalMarkdown/plugins/block-decorator-navigation';
import { createMenuOperations } from '@core/component/LexicalMarkdown/shared/inlineMenu';
import {
  $getCaretRect,
  forceSetTextContent,
  initializeEditorEmpty,
  isRectFlushWith,
  trimWhitespace,
} from '@core/component/LexicalMarkdown/utils';
import { blockNameToDefaultFile } from '@core/constant/allBlocks';
import { fireAndForget } from '@core/util/fireAndForget';
import { onElementConnect } from '@core/util/onElementConnect';
import { createRenameDssEntityMutation } from '@entity';
import { mergeRegister } from '@lexical/utils';
import { useDocTags } from '@property/tags';
import { EntityType } from '@service-properties/generated/schemas/entityType';
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
  KEY_TAB_COMMAND,
  type LexicalEditor,
} from 'lexical';
import { ResultAsync } from 'neverthrow';
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
import { useMarkdownDocument } from '../context/markdown-document-context';
import { useMarkdownName } from './MarkdownNameProvider';
import { shouldAutofocusDocument } from './should-autofocus-document';

type TitleRename = {
  newName: string;
  oldName: string;
};

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
          // A node selection places no DOM caret, so focus the body first.
          documentEditor.getRootElement()?.focus({ preventScroll: true });
          documentEditor.update($selectDocumentStart);
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
          // A node selection places no DOM caret, so focus the body first.
          documentEditor.getRootElement()?.focus({ preventScroll: true });
          documentEditor.update($selectDocumentStart);
          return true;
        },
        COMMAND_PRIORITY_NORMAL
      ),
      // Press tab in the title. Without this the browser moves focus to the
      // tag controls below the title instead of the body.
      titleEditor.registerCommand(
        KEY_TAB_COMMAND,
        (event: KeyboardEvent) => {
          if (ignoreArrows()) return true;
          if (event.shiftKey) return false;

          event.preventDefault();
          documentEditor.getRootElement()?.focus({ preventScroll: true });
          documentEditor.update($selectDocumentStart);
          return true;
        },
        COMMAND_PRIORITY_NORMAL
      )
    );
}

export function TitleEditor(props: { autoFocusOnMount?: boolean } = {}) {
  const {
    documentId,
    element: blockElement,
    kind,
    documentSource,
    permissions,
    state: documentState,
  } = useMarkdownDocument();
  const panel = useSplitPanel();
  const canEdit = permissions.canEdit;
  const { md: mdData, setMd: setMdData } = documentState.editor;
  const renameDocumentMutation = createRenameDssEntityMutation();
  const {
    persistedName: persistedDocumentName,
    editorName: mdDocumentName,
    setOptimisticName,
  } = useMarkdownName();

  const [showFallback, setShowFallback] = createSignal(true);
  const [titlePlaceholder] = createSignal<string>();

  const blockId = documentId();
  const documentKind = kind();
  const entityBlockName = documentKind === 'document' ? 'md' : documentKind;
  const documentTags = useDocTags(
    blockId,
    documentKind === 'task' ? EntityType.TASK : EntityType.DOCUMENT
  );
  const titlePlaceholderFallback = blockNameToDefaultFile(entityBlockName);

  let pendingRename: TitleRename | undefined;
  // Renames sent and not yet settled. Until they settle, the saved name can
  // lag behind the title, so it must not replace the title, and the name the
  // document ends with is the last one sent.
  let renamesInFlight = 0;
  let lastSentName = '';
  // Each rename waits for the one before it, so the server applies them in
  // the order they were typed.
  let previousRename: Promise<void> = Promise.resolve();

  const saveTitle = async (next: TitleRename, previous: Promise<void>) => {
    await previous;
    // A failed rename leaves the title as typed; the mutation reports it.
    await ResultAsync.fromPromise(
      renameDocumentMutation.mutateAsync({
        entity: {
          type: 'document',
          id: blockId,
          name: next.oldName,
        },
        newName: next.newName,
      }),
      (error) => error
    );
    renamesInFlight -= 1;
  };

  const flushPendingRename = () => {
    const next = pendingRename;
    pendingRename = undefined;
    if (!next || !canEdit()) return;
    renamesInFlight += 1;
    lastSentName = next.newName;
    previousRename = saveTitle(next, previousRename);
  };

  const scheduleRename = (newName: string, oldName: string) => {
    if (newName === oldName) {
      pendingRename = undefined;
      debouncedFlushRename.clear();
      return;
    }
    pendingRename = { newName, oldName };
    debouncedFlushRename();
  };

  const debouncedFlushRename = debounce(flushPendingRename, 400);
  // Unmount cancels the debounce timer, so save a pending rename now.
  onCleanup(flushPendingRename);

  const [state, setState] = createSignal('');
  const [initialized, setInitialized] = createSignal(false);

  const { editor, plugins, cleanup } = createLexicalWrapper({
    namespace: 'block-md-title',
    type: 'title',
    isInteractable: createMemo(() => {
      return canEdit() ?? false;
    }),
  });
  onCleanup(cleanup);

  initializeEditorEmpty(editor);

  setMdData('titleEditor', editor);

  const emojiMenuOperations = createMenuOperations();
  const tagMenuOperations = createMenuOperations();
  const inlineMenuOpen = () =>
    emojiMenuOperations.isOpen() || tagMenuOperations.isOpen();

  plugins
    .plainText()
    .history(400)
    .use(singleLinePlugin())
    .use(
      emojisPlugin({
        menu: emojiMenuOperations,
      })
    )
    .use(
      tagsPlugin({
        menu: tagMenuOperations,
        insertTags: false,
        onCreateTag: (tag) => {
          if (!canEdit()) return;
          fireAndForget(
            documentTags.applyTag(tag.scope, tag.optionId),
            'document-tags'
          );
        },
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

  // Wait for the main editor to be mounted, then register the navigate plugin.
  createEffect(() => {
    const mainDocumentEditor = mdData.editor;
    if (!mainDocumentEditor) return;
    plugins.use(titleNavigationPlugin(mainDocumentEditor, inlineMenuOpen));
  });

  function onBlur() {
    trimWhitespace(editor, { trailing: true });
  }

  const [rootConnected, setRootConnected] = createSignal(false);

  const onConnect = (el: HTMLDivElement) => {
    editor.setRootElement(el);
    el.addEventListener('blur', onBlur);
    setRootConnected(true);
    onCleanup(() => {
      el.removeEventListener('blur', onBlur);
    });
  };

  createEffect(() => {
    editor.setEditable(canEdit() ?? false);
  });

  const dataReady = () => documentSource().type !== 'loading';

  // The document's preview republishes whenever anything in its batch
  // changes, so compare the saved name by value: an unchanged name is not a
  // rename.
  const savedName = createMemo(() =>
    dataReady() ? persistedDocumentName() : undefined
  );

  /** Whether the title holds edits that are not saved yet: text typed into an
   * open emoji or tag menu, which is not saved while the menu is open, a rename
   * waiting for its debounce, or one in flight. */
  const hasUnsavedEdits = () =>
    untrack(inlineMenuOpen) ||
    pendingRename !== undefined ||
    renamesInFlight > 0;

  /** Puts the saved name in the title unless the title has edits of its own. */
  function showSavedName() {
    const name = untrack(savedName);
    if (name === undefined || name === untrack(state).trim()) return;
    if (hasUnsavedEdits()) return;
    forceSetTextContent(editor, name);
  }

  createEffect(on(savedName, showSavedName));

  createEffect(() => {
    const currentState = state();
    // Text typed into an open emoji or tag menu is saved once it closes.
    if (inlineMenuOpen()) return;
    if (!untrack(initialized)) {
      setInitialized(true);
      return;
    }
    const nextName = currentState.trim();
    if (nextName !== untrack(mdDocumentName)) {
      setOptimisticName(nextName);
    }
    // The name the document ends with once the renames already sent settle.
    const serverName =
      renamesInFlight > 0
        ? lastSentName
        : (untrack(persistedDocumentName) ?? '');
    if (nextName === serverName || canEdit()) {
      scheduleRename(nextName, serverName);
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

  // Autofocus a new document's empty title once its metadata has loaded.
  let didAutoFocus = false;
  createEffect(() => {
    activeElement();
    const name = mdDocumentName();
    if (
      !didAutoFocus &&
      props.autoFocusOnMount &&
      rootConnected() &&
      dataReady() &&
      name !== undefined
    ) {
      if (name === '') {
        if (
          shouldAutofocusDocument(
            blockElement() ?? null,
            panel?.panelRef() ?? null
          )
        ) {
          didAutoFocus = true;
          editor.focus();
        }
      } else {
        didAutoFocus = true;
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
      <TagsMenu
        editor={editor}
        menu={tagMenuOperations}
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
