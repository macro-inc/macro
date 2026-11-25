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
import { createMenuOperations } from '@core/component/LexicalMarkdown/shared/inlineMenu';
import {
  forceSetTextContent,
  initializeEditorEmpty,
  trimWhitespace,
} from '@core/component/LexicalMarkdown/utils';
import { blockNameToDefaultFile } from '@core/constant/allBlocks';
import { fireAndForget } from '@core/util/fireAndForget';
import { onElementConnect } from '@core/util/onElementConnect';
import { createRenameDssEntityMutation } from '@entity';
import { useDocTags } from '@property/tags';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import { debounce } from '@solid-primitives/scheduled';
import { useQueryClient } from '@tanstack/solid-query';
import { $getRoot, COMMAND_PRIORITY_NORMAL, KEY_ESCAPE_COMMAND } from 'lexical';
import { ResultAsync } from 'neverthrow';
import {
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
import { titleNavigationPlugin } from './title-navigation';

type TitleRename = {
  newName: string;
  oldName: string;
};

/** What a title rename mutation is called with. */
type TitleRenameVariables = {
  entity: { name: string };
  newName: string;
};

/** What a title rename mutation returns. */
type TitleRenameResult = { success: boolean };

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
  const {
    persistedName: persistedDocumentName,
    editorName: mdDocumentName,
    setOptimisticName,
  } = useMarkdownName();

  const [showFallback, setShowFallback] = createSignal(true);
  const [titlePlaceholder] = createSignal<string>();

  const blockId = documentId();
  const renameScope = `document-title:${blockId}`;
  // Renames of this document from every editor of it, including one closed
  // with a save still running, reach the server in the order they were made.
  const renameDocumentMutation = createRenameDssEntityMutation(
    undefined,
    renameScope
  );
  const mutationCache = useQueryClient().getMutationCache();
  /** This document's title renames still in the mutation cache, from every
   * editor of it, oldest first. */
  const titleRenames = () =>
    mutationCache
      .findAll({
        predicate: (mutation) => mutation.options.scope?.id === renameScope,
      })
      .flatMap((mutation) => {
        // The scope holds only renames made by the mutation above.
        const { status } = mutation.state;
        const variables = mutation.state.variables as
          | TitleRenameVariables
          | undefined;
        const data = mutation.state.data as TitleRenameResult | undefined;
        if (!variables) return [];
        const failed =
          status === 'error' || (status === 'success' && !data?.success);
        return [{ pending: status === 'pending', failed, variables }];
      });
  const documentKind = kind();
  const entityBlockName = documentKind === 'document' ? 'md' : documentKind;
  const documentTags = useDocTags(
    blockId,
    documentKind === 'task' ? EntityType.TASK : EntityType.DOCUMENT
  );
  const titlePlaceholderFallback = blockNameToDefaultFile(entityBlockName);

  let pendingRename: TitleRename | undefined;
  // Renames this title sent that have not settled. Until they settle, the
  // saved name can lag behind the title, so it must not replace the title.
  let renamesInFlight = 0;

  /**
   * The rename the title's text needs, or none when the document is sure to
   * end with that name. Renames already sent from any editor of the document
   * count: the last one that has not failed is the last the server applies.
   */
  const renameTo = (newName: string): TitleRename | undefined => {
    const last = titleRenames().findLast((rename) => !rename.failed);
    if (last?.pending) {
      const sentName = last.variables.newName;
      return newName === sentName ? undefined : { newName, oldName: sentName };
    }
    const savedName = untrack(persistedDocumentName) ?? '';
    if (newName !== savedName) return { newName, oldName: savedName };
    // A rename that has returned can still be queued, with the saved name not
    // showing it yet: the document is sure to keep the saved name only when
    // that rename agrees with it.
    const sentName = last?.variables.newName ?? savedName;
    return newName === sentName ? undefined : { newName, oldName: sentName };
  };

  /** Whether a title rename sent or replaced `name`. A saved name outside
   * them can only come from a rename made elsewhere; one inside them can be a
   * late copy of an earlier save. */
  const isTitleRenameName = (name: string) =>
    titleRenames().some(
      ({ variables }) =>
        variables.newName === name || variables.entity.name === name
    );

  const saveTitle = async (next: TitleRename) => {
    const saved = await ResultAsync.fromPromise(
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
    // A failed rename leaves the title as typed; the mutation reports it.
    if (saved.isErr() || !saved.value.success) return;
    // A rename made elsewhere while this one was in flight was held back.
    const name = untrack(savedName);
    if (name !== undefined && !isTitleRenameName(name)) showSavedName();
  };

  const flushPendingRename = () => {
    const next = pendingRename;
    pendingRename = undefined;
    if (!next || !canEdit()) return;
    renamesInFlight += 1;
    fireAndForget(saveTitle(next), 'block-md-title');
  };

  const scheduleRename = (next: TitleRename | undefined) => {
    pendingRename = next;
    if (next) debouncedFlushRename();
    else debouncedFlushRename.clear();
  };

  const debouncedFlushRename = debounce(flushPendingRename, 400);

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

  // The saved name the title was last set to, until the title is edited. That
  // text is not an edit: a reopened title can show a name another editor of
  // the document is still renaming, and saving it back would undo that rename.
  let shownName: string | undefined;

  /** Puts the saved name in the title unless the title has edits of its own. */
  function showSavedName() {
    const name = untrack(savedName);
    if (name === undefined || name === untrack(state).trim()) return;
    if (hasUnsavedEdits()) return;
    shownName = name;
    // The label follows the title: drop a typed name that was never saved.
    setOptimisticName(undefined);
    forceSetTextContent(editor, name);
  }

  createEffect(on(savedName, showSavedName));

  const saveTitleText = (text: string) => {
    const nextName = text.trim();
    if (nextName === shownName) return;
    shownName = undefined;
    if (nextName !== untrack(mdDocumentName)) {
      setOptimisticName(nextName);
    }
    const next = renameTo(nextName);
    if (!next || canEdit()) scheduleRename(next);
  };

  createEffect(() => {
    const currentState = state();
    // Text typed into an open emoji or tag menu is saved once it closes.
    if (inlineMenuOpen()) return;
    if (!untrack(initialized)) {
      setInitialized(true);
      return;
    }
    saveTitleText(currentState);
  });

  // Unmount cancels the debounce timer, so save a pending rename now, with
  // any text still in an open emoji or tag menu.
  onCleanup(() => {
    if (untrack(inlineMenuOpen) && untrack(initialized)) {
      saveTitleText(untrack(state));
    }
    flushPendingRename();
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
