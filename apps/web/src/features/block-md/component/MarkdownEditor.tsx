import { MessageCommentsProvider } from '@block-md/comments/MessageCommentsProvider';
import { URL_PARAMS } from '@block-md/constants';
import { keyNavigationPlugin } from '@block-md/plugins/keyboardNavigation';
import { SplitBottomPanel } from '@components/app/split-layout/components/SplitBottomPanel';
import { FocusClickTarget } from '@core/component/LexicalMarkdown/component/core/FocusClickTarget';
import {
  HighlightLayer,
  LocationHighlight,
} from '@core/component/LexicalMarkdown/component/core/Highlights';
import { LexicalStateDebugger } from '@core/component/LexicalMarkdown/component/debug/LexicalStateDebugger';
import { GenerateMenu } from '@core/component/LexicalMarkdown/component/menu/GenerateMenu';
import { TagsMenu } from '@core/component/LexicalMarkdown/component/menu/TagsMenu';
import {
  getErrorDescription,
  MarkdownEditorErrors,
} from '@core/component/LexicalMarkdown/constants';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import { useEditorEntityDrop } from '@core/component/LexicalMarkdown/editing/entityDrop';
import { MarkdownEditingOverlays } from '@core/component/LexicalMarkdown/editing/MarkdownEditingOverlays';
import {
  type MarkdownEditingSource,
  registerMarkdownEditing,
} from '@core/component/LexicalMarkdown/editing/registerMarkdownEditing';
import {
  CLOSE_INLINE_SEARCH_COMMAND,
  createProgressStatsStore,
  createWordcountStatsStore,
  diffPlugin,
  generatePlugin,
  pinnedPropertiesPlugin,
  progressPlugin,
  tagsPlugin,
  wordcountPlugin,
} from '@core/component/LexicalMarkdown/plugins';
import {
  BlameTooltip,
  blameTooltipPlugin,
  createBlameTooltipStore,
} from '@core/component/LexicalMarkdown/plugins/blame-tooltip';
import {
  DO_SEARCH_COMMAND,
  FloatingSearchHighlight,
  findAndReplacePlugin,
  type NodekeyOffset,
  SearchHighlight,
} from '@core/component/LexicalMarkdown/plugins/find-and-replace';
import {
  GO_TO_LOCATION_COMMAND,
  GO_TO_NODE_ID_COMMAND,
  locationPlugin,
  type PersistentLocation,
  parsePersistentLocation,
} from '@core/component/LexicalMarkdown/plugins/location';
import {
  autoRegister,
  lazyRegister,
  registerInternalLayoutShiftListener,
} from '@core/component/LexicalMarkdown/plugins/shared/utils';
import type { MentionLinkResolver } from '@core/component/LexicalMarkdown/plugins/text-paste/textPastePlugin';
import { createMenuOperations } from '@core/component/LexicalMarkdown/shared/inlineMenu';
import {
  editorFocusSignal,
  editorIsEmpty,
  getSaveState,
  initializeEditorEmpty,
  initializeEditorWithState,
  setEditorStateFromMarkdown,
} from '@core/component/LexicalMarkdown/utils';
import { useUrlParams } from '@core/component/ParamsProvider';
import { toast } from '@core/component/Toast/Toast';
import {
  ENABLE_MARKDOWN_AI_GENERATE,
  ENABLE_MARKDOWN_COMMENTS,
  ENABLE_MARKDOWN_DIFF,
  ENABLE_MARKDOWN_LIVE_COLLABORATION,
  enableGitBlame,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { bufToString } from '@core/util/string';
import type { LoroManager } from '@macro-inc/collaboration/collab/manager';
import {
  $isInlineSearchNode,
  createPeerIdValidator,
  type PeerIdValidator,
} from '@macro-inc/lexical-core';
import { useDocTags } from '@property/tags';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import { onElementConnect } from '@solid-primitives/lifecycle';
import { isIOS } from '@solid-primitives/platform';
import { createCallback } from '@solid-primitives/rootless';
import { debounce } from '@solid-primitives/scheduled';
import { $getRoot, $isElementNode, type EditorState } from 'lexical';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  Show,
  Suspense,
  untrack,
} from 'solid-js';
import { useMarkdownDocument } from '../context/markdown-document-context';
import { createSaveMarkdownDocumentMutation } from '../queries/markdown-document-operations';
import { EditorSystemMessage } from './EditorSystemMessage';
import { MarkdownCollabProvider } from './MarkdownCollabProvider';
import { MarkdownPopup } from './MarkdownPopup';
import { isMarkdownEditorLoading } from './markdownEditorLoadingState';

false && fileFolderDrop;

// Keep the bottom click target compact so document discussion stays visible.
const EDITOR_CLICK_TARGET_HEIGHT = 80;

function getBlankMarkdownPlaceholder(canEdit: boolean) {
  if (!canEdit) return 'This document is blank...';

  const hints = [
    "'/' for commands",
    "'@' to reference files",
    "';' for snippets",
  ];
  if (ENABLE_MARKDOWN_AI_GENERATE) hints.push("'space' for AI writing");

  return `Press ${hints.join(', ')}...`;
}

export function MarkdownEditor(props: {
  autoFocusOnMount?: boolean;
  loroManager: LoroManager;
  showLexicalStateDebugger?: boolean;
  onLexicalStateDebuggerClose?: () => void;
  resolveAppLink?: MentionLinkResolver;
}) {
  const {
    documentId,
    kind,
    documentSource,
    persistedName: mdDocumentName,
    permissions,
    state: documentState,
  } = useMarkdownDocument();
  const { canEdit, canComment } = permissions;
  const blockId = documentId();
  const documentKind = kind();
  const sourceBlockName = documentKind === 'document' ? 'md' : documentKind;
  const documentTags = useDocTags(
    blockId,
    documentKind === 'task' ? EntityType.TASK : EntityType.DOCUMENT
  );
  const tagApplyTargetLabel = () =>
    documentKind === 'task' ? 'Task' : 'Document';

  const saveDocumentMutation = createSaveMarkdownDocumentMutation();
  const {
    md,
    setMd: setMdStore,
    error: editorError,
    setError: setEditorError,
    findAndReplace: findAndReplaceStore,
    setFindAndReplace: setFindAndReplaceStore,
  } = documentState.editor;
  const saveBlocked = () => documentState.comments.activeCommentThread === -1;

  const IS_SYNC = () => documentSource().type === 'sync';

  const debouncedSaveState = debounce(() => {
    const state_ = state();
    if (!state_ || !canEdit() || saveBlocked()) return;
    const savableState = getSaveState(editor.getEditorState());
    saveDocumentMutation.mutate({
      documentId: blockId,
      text: JSON.stringify(savableState),
    });
  }, 500);

  // flush save state after unblocking
  createEffect((prev) => {
    const saveBlocked_ = saveBlocked();
    // no save on load
    if (!saveBlocked_ && prev !== undefined) {
      debouncedSaveState();
    }

    return saveBlocked_;
  }, undefined);

  let editorContainerRef!: HTMLDivElement;

  const [clickTargetHeight, setClickTargetHeight] = createSignal(0);
  const {
    isGenerating,
    setIsGenerating,
    generatedAndWaiting,
    setGeneratedAndWaiting,
    completion,
    setCompletion,
    generateMenuOpen,
    setGenerateMenuOpen,
    setGenerateContext,
  } = documentState.generation;
  const completionSignal = [completion, setCompletion] as [
    typeof completion,
    typeof setCompletion,
  ];
  const isGeneratingSignal = [isGenerating, setIsGenerating] as [
    typeof isGenerating,
    typeof setIsGenerating,
  ];
  const generatedAndWaitingSignal = [
    generatedAndWaiting,
    setGeneratedAndWaiting,
  ] as [typeof generatedAndWaiting, typeof setGeneratedAndWaiting];
  const generateMenuSignal = [generateMenuOpen, setGenerateMenuOpen] as [
    typeof generateMenuOpen,
    typeof setGenerateMenuOpen,
  ];

  const [editorReady, setEditorReady] = createSignal<boolean>(false);

  const [highlightLayerRef, setHighlightLayerRef] =
    createSignal<HTMLDivElement>();

  createEffect(() => {
    // We still want the editor to be locked down (for certain things like click events on check
    // lists) when the user does not have editor access.
    editor.setEditable(editorReady() && (canEdit() || canComment()));
  });

  const isContentEditable = createMemo(() => {
    return (
      editorReady() &&
      (canEdit() ?? false) &&
      !isGenerating() &&
      !generatedAndWaiting() &&
      !editorError()
    );
  });

  const lexicalWrapper = createLexicalWrapper({
    type: 'markdown-sync',
    namespace: 'block-md-main',
    isInteractable: isContentEditable,
    withIds: true,
  });

  const { editor, plugins, cleanup: cleanupPlugins } = lexicalWrapper;

  const [state, setState] = createSignal<EditorState>(editor.getEditorState());

  setMdStore('editor', editor);
  setMdStore('mapping', lexicalWrapper.mapping);
  setMdStore('plugins', plugins);

  const [editorFocus, setEditorFocus] = createSignal(false);
  autoRegister(editorFocusSignal(editor, setEditorFocus));

  const tagsMenuOperations = createMenuOperations();

  const onSetListOffset = (listOffset: NodekeyOffset[]) => {
    setFindAndReplaceStore('listOffset', listOffset);
    if (findAndReplaceStore.currentMatch >= listOffset.length) {
      setFindAndReplaceStore('currentMatch', 0);
    }
  };

  const [highlightNodeId, setHighlightNodeId] = createSignal<string>();
  const [activeCommentIdParam, setActiveCommentIdParam] = createSignal<
    string | undefined
  >(undefined, { equals: false });

  const [activeLocation, setActiveLocation] =
    createSignal<PersistentLocation>();
  const [locationReady, setLocationReady] = createSignal(false);

  createEffect(() => {
    setMdStore({ locationReady: locationReady() });
  });
  onCleanup(() => {
    setMdStore({ locationReady: undefined });
  });

  const { nodeId, location, commentId } = useUrlParams(URL_PARAMS);
  createEffect(on(nodeId, (id) => setHighlightNodeId(id ?? undefined)));
  createEffect(
    on(commentId, (id) => {
      setActiveCommentIdParam(id ?? undefined);
    })
  );
  createEffect(
    on(location, (loc) => {
      if (loc) {
        const locationObj = parsePersistentLocation(loc);
        if (locationObj) {
          setActiveLocation(locationObj);
        }
      }
    })
  );

  plugins.use(
    locationPlugin({
      mapping: lexicalWrapper.mapping,
      revokeOptions: {
        onRevokeLocation: () => {
          setActiveLocation();
        },
        selectionChange: () => locationReady(),
        mutation: () => locationReady(),
      },
    })
  );

  // The location plugin should lag behind the editor to avoid scroll jank while the
  // lexical DOM is still reconciling on first load.
  createEffect(() => {
    if (editorReady()) {
      setTimeout(() => setLocationReady(true));
    }
  });

  createEffect(() => {
    if (activeLocation() && locationReady()) {
      editor.dispatchCommand(GO_TO_LOCATION_COMMAND, activeLocation());
    }
  });

  createEffect(() => {
    const highlightNodeId_ = highlightNodeId();
    if (highlightNodeId_ && locationReady()) {
      setHighlightNodeId(undefined);
      const found = editor.dispatchCommand(
        GO_TO_NODE_ID_COMMAND,
        highlightNodeId_
      );
      if (!found) {
        toast.failure('Document reference not found');
      }
    }
  });

  const peerIdValidator: Accessor<PeerIdValidator> = () => {
    if (!IS_SYNC()) {
      return createPeerIdValidator(() => undefined, false);
    }
    const peerId = () => props.loroManager.peerIdStr;
    return createPeerIdValidator(peerId, true);
  };

  const editingSource: MarkdownEditingSource = {
    id: blockId,
    blockName: sourceBlockName,
    trackMentions: true,
  };

  // plugins
  plugins
    .richText()
    .list()
    .markdownShortcuts()
    .delete()
    .state<EditorState>(setState, 'json')
    .history(400, props.loroManager);
  const editing = registerMarkdownEditing({
    lexicalWrapper,
    isContentEditable,
    peerIdValidator: peerIdValidator(),
    source: editingSource,
    resolveAppLink: props.resolveAppLink,
    parentTaskId: documentKind === 'task' ? blockId : undefined,
    onVersionError: (error) => setEditorError(error),
    peerId: ENABLE_MARKDOWN_LIVE_COLLABORATION
      ? () => props.loroManager.peerIdStr
      : undefined,
    iosScrollContainer:
      isIOS || isNativeMobilePlatform() ? () => md.scrollContainer : undefined,
    slots: {
      afterMentions: [
        tagsPlugin({
          menu: tagsMenuOperations,
          peerIdValidator: peerIdValidator(),
        }),
      ],
      afterFilePaste: [
        findAndReplacePlugin({
          getListOffset: () => findAndReplaceStore.listOffset,
          setListOffset: onSetListOffset,
        }),
      ],
      beforeAwait: [pinnedPropertiesPlugin()],
      beforeCode: ([accessoryStore, setAccessoryStore]) => [
        ...(ENABLE_MARKDOWN_DIFF ? [diffPlugin()] : []),
        ...(ENABLE_MARKDOWN_AI_GENERATE
          ? [
              generatePlugin({
                completionSignal: completionSignal,
                isGeneratingSignal,
                generatedAndWaitingSignal,
                menuSignal: generateMenuSignal,
                setContext: setGenerateContext,
                accessories: accessoryStore,
                setAccessories: setAccessoryStore,
              }),
            ]
          : []),
      ],
    },
  });
  const droppable = useEditorEntityDrop({
    editor,
    canEdit: () => canEdit() ?? false,
    dragInsert: editing.dragInsert,
    source: editingSource,
  });
  false && droppable;

  const [editorHasNoContent, setEditorHasNoContent] = createSignal(false);

  const observeClickTargetHeight = () => {
    setClickTargetHeight(EDITOR_CLICK_TARGET_HEIGHT);
  };

  createEffect(() => {
    observeClickTargetHeight();
  });

  autoRegister(
    registerInternalLayoutShiftListener(editor, observeClickTargetHeight)
  );

  const onConnect = (el: HTMLDivElement) => {
    setMdStore('selection', lexicalWrapper.selection);
    editor.setRootElement(el);

    // Register plugins that require the container ref.
    editing.connectContainer(editorContainerRef);

    const editorRefObserver = new ResizeObserver(observeClickTargetHeight);

    editorRefObserver.observe(el);
    onCleanup(() => {
      editorRefObserver.disconnect();
    });
  };

  const additionalCleanups: Array<() => void> = [];

  onCleanup(() => {
    additionalCleanups.forEach((cleanup) => cleanup());
    cleanupPlugins();
  });

  const [titleEditorMenuOpen, setTitleEditorMenuOpen] = createSignal(false);

  lazyRegister(
    () => md.titleEditor,
    (titleEditor) => {
      return titleEditor.registerUpdateListener(({ editorState }) => {
        let prev = titleEditorMenuOpen();
        let next = editorState.read(() => {
          const firstChild = $getRoot()?.getFirstChild();
          if (!firstChild || !$isElementNode(firstChild)) return false;
          return firstChild.getChildren().some((c) => $isInlineSearchNode(c));
        });
        if (next !== prev) setTitleEditorMenuOpen(next);
      });
    }
  );

  // Are are any of the inline menus open? This effects the behavior of the
  // array keys.
  const isInlineMenuOpen = createMemo(() => {
    return editing.isInlineMenuOpen() || titleEditorMenuOpen();
  });

  createEffect(() => {
    // We still want the editor to be locked down (for certain things like click events on check
    // lists) when the user does not have editor access.
    editor.setEditable(editorReady() && (canEdit() ?? false));
  });

  plugins.useReactive(
    () => md.titleEditor,
    () => {
      if (md.titleEditor)
        return keyNavigationPlugin(md.titleEditor, isInlineMenuOpen);
    }
  );

  const isBlankMarkdown = createMemo(() => {
    return editorHasNoContent() && !generateMenuOpen();
  });

  const [, setTitleIsEmpty] = createSignal(false);
  createEffect(() => {
    const titleEditor = md.titleEditor;
    if (!titleEditor) return;

    const removeListener = titleEditor.registerUpdateListener(
      ({ editorState }) => {
        setTitleIsEmpty(editorIsEmpty(editorState));
      }
    );

    onCleanup(() => removeListener());
  });

  // not all changes that can trigger preview display are text content changes.
  additionalCleanups.push(
    editor.registerUpdateListener(({ editorState }) => {
      setEditorHasNoContent(editorIsEmpty(editorState));
    })
  );

  // handle changes to the editor after initial load
  const registerSaveListener = () => {
    additionalCleanups.push(
      editor.registerUpdateListener(({ mutatedNodes }) => {
        if (mutatedNodes === null || mutatedNodes.size === 0) return;
        debouncedSaveState();
      })
    );
  };

  let searchRefreshQueued = false;
  const queueSearchRefresh = () => {
    if (searchRefreshQueued) return;
    searchRefreshQueued = true;
    queueMicrotask(() => {
      searchRefreshQueued = false;
      if (
        findAndReplaceStore.searchIsOpen &&
        findAndReplaceStore.searchInputText
      ) {
        editor.dispatchCommand(
          DO_SEARCH_COMMAND,
          findAndReplaceStore.searchInputText
        );
      }
    });
  };

  // Refresh highlights only after content mutations. Selection-only updates
  // still fire Lexical update listeners and must not synchronously dispatch
  // another command from inside the commit.
  additionalCleanups.push(
    editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
      if (!findAndReplaceStore.searchIsOpen) return;
      if (!findAndReplaceStore.searchInputText) return;
      queueSearchRefresh();
    })
  );

  const [fileArrayBuffer, setFileArrayBuffer] = createSignal<ArrayBuffer>();
  createEffect(() => {
    const source = documentSource();
    if (source.type !== 'dss') return;

    source.file.arrayBuffer().then(setFileArrayBuffer);
  });

  createEffect(() => {
    if (documentSource().type !== 'dss') return;
    if (editorReady()) return;

    const buf = fileArrayBuffer();
    if (!buf) return;
    const text = bufToString(buf);

    // Blank state is a new document.
    if (text === '') {
      setEditorHasNoContent(true);
      initializeEditorEmpty(editor);

      registerSaveListener();
      // Mark ready so the loading skeleton clears and the blank placeholder shows.
      setEditorReady(true);
      return;
    }

    // Valid JSON state is an existing document.
    let validJson = true;
    try {
      const parsed = JSON.parse(text);
      initializeEditorWithState(editor, parsed);

      // don't open any hanging inline searches.
      editor.dispatchCommand(CLOSE_INLINE_SEARCH_COMMAND, undefined);

      if (editorIsEmpty(editor.getEditorState())) {
        setEditorHasNoContent(true);
      }

      registerSaveListener();
      setEditorReady(true);
      return;
    } catch (e) {
      console.error('LexicalParseError : ', e);
      validJson = false;
    }

    // Fallback is treated as a markdown string.
    if (!validJson) {
      setEditorStateFromMarkdown(editor, text);
      if (editorIsEmpty(editor.getEditorState())) {
        setEditorHasNoContent(true);
      }

      // Fallback is treated as a markdown string.
      if (!validJson) {
        setEditorStateFromMarkdown(editor, text);
        registerSaveListener();
      }

      if (editorIsEmpty(editor)) {
        setEditorError(MarkdownEditorErrors.EMPTY_SOURCE);
      }
    }

    setEditorReady(true);
  });

  // Auto-focus on mount if enabled and editor is ready and document name is not empty.
  createEffect(() => {
    if (
      props.autoFocusOnMount &&
      editorReady() &&
      untrack(mdDocumentName) !== ''
    ) {
      editor.focus(undefined, { defaultSelection: 'rootStart' });
    }
  });

  // Temporarily disabled pending port to connection-gateway.
  const _generateContentCallback = createCallback((_userRequest: string) => {
    setIsGenerating(true);
  });

  const [blameTooltipStore, setBlameTooltipStore] = createBlameTooltipStore();
  if (isFeatureEnabled(enableGitBlame)) {
    plugins.use(
      blameTooltipPlugin({ setState: (s) => setBlameTooltipStore(s) })
    );
  }

  const [wordcountStats, setWordcountStats] = createWordcountStatsStore();
  plugins.use(
    wordcountPlugin({ setStore: setWordcountStats, debounceTime: 200 })
  );
  setMdStore('wordcountStats', wordcountStats);

  const [progressStats, setProgressStats] = createProgressStatsStore();
  plugins.use(progressPlugin({ setStore: setProgressStats }));
  setMdStore('progressStats', progressStats);

  return (
    <LexicalWrapperContext.Provider value={lexicalWrapper}>
      <Show when={editorError()}>
        {(error) => (
          <EditorSystemMessage variant="warning" class="mb-2">
            {getErrorDescription(error())}
          </EditorSystemMessage>
        )}
      </Show>
      {/* Note: the mt-1.5 here is to preserve markdown node margin tops. which means this div should avoid padding and border. */}
      <div
        class="relative mt-1.5 text-base"
        ref={editorContainerRef}
        use:fileFolderDrop={{
          onDrop: (fileEntries, folderEntries, e) => {
            if (!e) return;
            editing.dropFiles(fileEntries, folderEntries, e, 'md');
          },
        }}
        use:droppable
      >
        <div
          ref={(el) => {
            onElementConnect(el, () => {
              onConnect(el);
            });
          }}
          contentEditable={isContentEditable()}
          role="textbox"
          aria-multiline="true"
          aria-readonly={!isContentEditable()}
          aria-label="Document content"
          class="ph-no-capture w-full max-w-full min-h-52"
          classList={{
            'select-auto': !canEdit(),
            'md-no-comments': !ENABLE_MARKDOWN_COMMENTS,
          }}
        />

        <Show when={IS_SYNC()}>
          <MarkdownCollabProvider
            editor={editor}
            pluginManager={plugins}
            editorContainerRef={editorContainerRef}
            highlighLayerRef={highlightLayerRef() ?? editorContainerRef}
            mappings={lexicalWrapper.mapping!}
            editorFocus={editorFocus}
            setEditorReady={setEditorReady}
            setEditorError={setEditorError}
            loroManager={props.loroManager}
          />
        </Show>

        <FocusClickTarget
          editor={editor}
          editorFocus={editorFocus}
          style={{ height: `${clickTargetHeight()}px` }}
        />
        <Show when={isMarkdownEditorLoading(editorReady(), editorError())}>
          <div
            aria-hidden="true"
            class="pointer-events-none absolute inset-x-0 top-0 flex flex-col gap-2.5 pt-1"
          >
            <div class="skeleton-shimmer h-2.5 w-full rounded-full bg-skeleton" />
            <div class="skeleton-shimmer h-2.5 w-full rounded-full bg-skeleton" />
            <div class="skeleton-shimmer h-2.5 w-2/3 rounded-full bg-skeleton" />
          </div>
        </Show>
        <Show when={editorReady() && isBlankMarkdown()}>
          <div class="pointer-events-none text-ink-placeholder absolute top-0">
            {getBlankMarkdownPlaceholder(canEdit())}
          </div>
        </Show>
        <Show when={isFeatureEnabled(enableGitBlame)}>
          <Suspense>
            <BlameTooltip state={blameTooltipStore} documentId={blockId} />
          </Suspense>
        </Show>
        <HighlightLayer
          editor={editor}
          ref={(el) => {
            setHighlightLayerRef(el as HTMLDivElement);
          }}
        />

        <Show when={locationReady()}>
          <LocationHighlight
            editor={editor}
            mountRef={highlightLayerRef() ?? editorContainerRef}
            location={activeLocation()}
            mapping={lexicalWrapper.mapping}
            class="bg-accent/50"
          />
        </Show>

        <MarkdownEditingOverlays
          editor={editor}
          editing={editing}
          source={editingSource}
          canEdit={() => canEdit() ?? false}
          useBlockBoundary={true}
          showOpenTabs
          floatingMenus={
            <MarkdownPopup
              highlightLayerRef={highlightLayerRef() ?? editorContainerRef}
              lexicalMapping={lexicalWrapper.mapping}
            />
          }
        />

        <TagsMenu
          editor={editor}
          menu={tagsMenuOperations}
          useBlockBoundary={true}
          applyTargetLabel={tagApplyTargetLabel()}
          isApplied={(tag) => documentTags.isApplied(tag.optionId)}
          onApplyTag={(tag) => {
            if (!canEdit()) return;
            void documentTags.applyTag(tag.scope, tag.optionId);
          }}
        />

        <Show when={findAndReplaceStore.searchIsOpen}>
          <SearchHighlight
            anchorElem={highlightLayerRef() ?? editorContainerRef}
            listOffset={findAndReplaceStore.listOffset}
            onStylesChange={(styles) =>
              setFindAndReplaceStore('styles', styles)
            }
            onMatchesChange={(matches) =>
              setFindAndReplaceStore('matches', matches)
            }
          />
          <FloatingSearchHighlight
            anchorElem={highlightLayerRef() ?? editorContainerRef}
            styles={findAndReplaceStore.styles}
            currentMatch={findAndReplaceStore.currentMatch}
          />
        </Show>

        <Show when={ENABLE_MARKDOWN_COMMENTS}>
          <Suspense>
            <MessageCommentsProvider
              activeComment={activeCommentIdParam}
              loroManager={props.loroManager}
            />
          </Suspense>
        </Show>

        <Show when={ENABLE_MARKDOWN_AI_GENERATE}>
          <GenerateMenu
            generateCallback={_generateContentCallback}
            menuOpen={generateMenuSignal}
            completionSignal={completionSignal[0]}
            generatedAndWaiting={generatedAndWaiting}
            isGenerating={isGenerating}
            editor={editor}
          />
        </Show>

        <Show when={props.showLexicalStateDebugger}>
          <Show when={state()}>
            {(state) => (
              <SplitBottomPanel
                id="lexical-state-debugger"
                title="Lexical state debugger"
                onClose={props.onLexicalStateDebuggerClose}
              >
                <LexicalStateDebugger
                  state={state()}
                  editor={editor}
                ></LexicalStateDebugger>
              </SplitBottomPanel>
            )}
          </Show>
        </Show>
      </div>
    </LexicalWrapperContext.Provider>
  );
}
