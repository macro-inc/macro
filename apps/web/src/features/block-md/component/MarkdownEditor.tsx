import { URL_PARAMS as CHANNEL_PARAMS } from '@block-channel/constants';
import { CommentsProvider } from '@block-md/comments/CommentsProvider';
import { URL_PARAMS } from '@block-md/constants';
import { keyNavigationPlugin } from '@block-md/plugins/keyboardNavigation';
import { markdownBlockErrorSignal } from '@block-md/signal/error';
import { FindAndReplaceStore } from '@block-md/signal/findAndReplaceStore';
import { revisionsSignal, rewriteSignal } from '@block-md/signal/rewriteSignal';
import { SplitBottomPanel } from '@components/app/split-layout/components/SplitBottomPanel';
import {
  type BlockName,
  useBlockId,
  useMaybeBlockAliasedName,
} from '@core/block';
import { DecoratorRenderer } from '@core/component/LexicalMarkdown/component/core/DecoratorRenderer';
import { FocusClickTarget } from '@core/component/LexicalMarkdown/component/core/FocusClickTarget';
import {
  HighlightLayer,
  LocationHighlight,
} from '@core/component/LexicalMarkdown/component/core/Highlights';
import { NodeAccessoryRenderer } from '@core/component/LexicalMarkdown/component/core/NodeAccessoryRenderer';
import { LexicalStateDebugger } from '@core/component/LexicalMarkdown/component/debug/LexicalStateDebugger';
import { ActionMenu } from '@core/component/LexicalMarkdown/component/menu/ActionsMenu';
import { EmojiMenu } from '@core/component/LexicalMarkdown/component/menu/EmojiMenu';
import { FloatingEquationMenu } from '@core/component/LexicalMarkdown/component/menu/FloatingEquationMenu';
import { FloatingLinkMenu } from '@core/component/LexicalMarkdown/component/menu/FloatingLinkMenu';
import { FloatingTableMenu } from '@core/component/LexicalMarkdown/component/menu/FloatingTableMenu';
import { GenerateMenu } from '@core/component/LexicalMarkdown/component/menu/GenerateMenu';
import { MentionsMenu } from '@core/component/LexicalMarkdown/component/menu/MentionsMenu/MentionsMenu';
import { SnippetsMenu } from '@core/component/LexicalMarkdown/component/menu/SnippetsMenu';
import { TagsMenu } from '@core/component/LexicalMarkdown/component/menu/TagsMenu';
import { DraggableBlockMenu } from '@core/component/LexicalMarkdown/component/misc/DraggableBlockMenu';
import { DragInsertIndicator } from '@core/component/LexicalMarkdown/component/misc/DragInsertIndicator';
import { TableCellResizer } from '@core/component/LexicalMarkdown/component/misc/TableCellResizer';
import { TableDeleteButtons } from '@core/component/LexicalMarkdown/component/misc/TableDeleteButtons';
import { TableInsertButton } from '@core/component/LexicalMarkdown/component/misc/TableInsertButton';
import { TableMoveHandle } from '@core/component/LexicalMarkdown/component/misc/TableMoveHandle';
import { TableSelectionActionBar } from '@core/component/LexicalMarkdown/component/misc/TableSelectionActionBar';
import {
  getErrorDescription,
  MarkdownEditorErrors,
} from '@core/component/LexicalMarkdown/constants';
import { FloatingMenuGroup } from '@core/component/LexicalMarkdown/context/FloatingMenuContext';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import {
  awaitPlugin,
  CLOSE_INLINE_SEARCH_COMMAND,
  createDraggableBlockStore,
  createDragInsertStore,
  createProgressStatsStore,
  createWordcountStatsStore,
  DefaultShortcuts,
  diffPlugin,
  documentMetadataPlugin,
  draggableBlockPlugin,
  dragInsertPlugin,
  filePastePlugin,
  generatePlugin,
  horizontalRulePlugin,
  keyboardShortcutsPlugin,
  listToTablePlugin,
  markdownPastePlugin,
  mentionsPlugin,
  pinnedPropertiesPlugin,
  progressPlugin,
  selectionDataPlugin,
  tabIndentationPlugin,
  tableCellResizerPlugin,
  tablePlugin,
  tableTouchSelectionPlugin,
  tagsPlugin,
  textPastePlugin,
  trailingParagraphPlugin,
  wordcountPlugin,
} from '@core/component/LexicalMarkdown/plugins';
import { actionsPlugin } from '@core/component/LexicalMarkdown/plugins/actions/actionsPlugin';
import {
  BlameTooltip,
  blameTooltipPlugin,
  createBlameTooltipStore,
} from '@core/component/LexicalMarkdown/plugins/blame-tooltip';
import {
  CONVERT_CHECKBOXES_TO_TASKS,
  checkboxToTaskPlugin,
} from '@core/component/LexicalMarkdown/plugins/checkbox-to-task';
import { codePlugin } from '@core/component/LexicalMarkdown/plugins/code/codePlugin';
import { emojisPlugin } from '@core/component/LexicalMarkdown/plugins/emojis/emojisPlugin';
import {
  DO_SEARCH_COMMAND,
  FloatingSearchHighlight,
  findAndReplacePlugin,
  type NodekeyOffset,
  SearchHighlight,
} from '@core/component/LexicalMarkdown/plugins/find-and-replace';
import { iosCursorScrollPlugin } from '@core/component/LexicalMarkdown/plugins/ios-cursor-scroll';
import {
  GO_TO_LOCATION_COMMAND,
  GO_TO_NODE_ID_COMMAND,
  locationPlugin,
  type PersistentLocation,
  parsePersistentLocation,
} from '@core/component/LexicalMarkdown/plugins/location';
import {
  INSERT_MEDIA_COMMAND,
  mediaPlugin,
} from '@core/component/LexicalMarkdown/plugins/media';
import { createAccessoryStore } from '@core/component/LexicalMarkdown/plugins/node-accessory';
import { normalizeEnterPlugin } from '@core/component/LexicalMarkdown/plugins/normalize-enter/';
import { restoreFocusPlugin } from '@core/component/LexicalMarkdown/plugins/restore-focus';
import {
  autoRegister,
  lazyRegister,
  registerInternalLayoutShiftListener,
} from '@core/component/LexicalMarkdown/plugins/shared/utils';
import { snippetsPlugin } from '@core/component/LexicalMarkdown/plugins/snippets';
import { createMenuOperations } from '@core/component/LexicalMarkdown/shared/inlineMenu';
import {
  editorFocusSignal,
  editorIsEmpty,
  getSaveState,
  initializeEditorEmpty,
  initializeEditorWithState,
  setEditorStateFromMarkdown,
} from '@core/component/LexicalMarkdown/utils';
import {
  getValidDragInsertPosition,
  insertDocumentMentionAtDragInsertPosition,
  updateDragInsertPreviewFromCoordinates,
} from '@core/component/LexicalMarkdown/utils/dragInsertUtils';
import {
  createFilesReadyHandler,
  getDragDropPosition,
} from '@core/component/LexicalMarkdown/utils/fileUploadUtils';
import { useUrlParams } from '@core/component/ParamsProvider';
import { toast } from '@core/component/Toast/Toast';
import { itemToBlockName } from '@core/constant/allBlocks';
import {
  ENABLE_MARKDOWN_AI_GENERATE,
  ENABLE_MARKDOWN_COMMENTS,
  ENABLE_MARKDOWN_DIFF,
  ENABLE_MARKDOWN_LIVE_COLLABORATION,
  enableGitBlame,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { IS_MAC } from '@core/constant/isMac';
import { useUserId } from '@core/context/user';
import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createMethodRegistration } from '@core/orchestrator';
import {
  blockFileSignal,
  blockHandleSignal,
  blockSourceSignal,
} from '@core/signal/load';
import { trackMention } from '@core/signal/mention';
import { useCanComment, useCanEdit } from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { isSourceDSS, isSourceSyncService } from '@core/util/source';
import { bufToString } from '@core/util/string';
import { handleFileFolderDrop } from '@core/util/upload';
import { type EntityDragEvent, isEntityDragEvent } from '@entity';
import type { LoroManager } from '@macro-inc/collaboration/collab/manager';
import {
  $isInlineSearchNode,
  AwaitNode,
  CommentNode,
  createPeerIdValidator,
  InlineSearchNode,
  type PeerIdValidator,
  peerIdPlugin,
} from '@macro-inc/lexical-core';
import { useDocTags } from '@property/tags';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import { onElementConnect } from '@solid-primitives/lifecycle';
import { isIOS } from '@solid-primitives/platform';
import { createCallback } from '@solid-primitives/rootless';
import { debounce, throttle } from '@solid-primitives/scheduled';
import { createDroppable, useDragDropContext } from '@thisbeyond/solid-dnd';
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
import {
  completionSignal,
  generateContentCallback,
  generateContextSignal,
  generatedAndWaitingSignal,
  generateMenuSignal,
  isGeneratingSignal,
} from '../signal/generateSignal';
import { blockDataSignal, mdStore } from '../signal/markdownBlockData';
import type { MarkdownRewriteOutput } from '../signal/rewriteSignal';
import { useBlockSave, useSaveMarkdownDocument } from '../signal/save';
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
}) {
  const blockData = blockDataSignal.get;
  const blockId = useBlockId();
  const userId = useUserId();
  const blockName = useMaybeBlockAliasedName();
  const documentTags = useDocTags(
    blockId,
    blockName === 'task' ? EntityType.TASK : EntityType.DOCUMENT
  );
  const tagApplyTargetLabel = () =>
    blockName === 'task' ? 'Task' : 'Document';

  const mdDocumentName = useBlockDocumentName('');

  const blockHandle = blockHandleSignal.get;
  const saveMarkdownDocument = useSaveMarkdownDocument();
  const setMdStore = mdStore.set;
  const md = mdStore.get;
  const canEdit = useCanEdit();
  const canComment = useCanComment();
  const [findAndReplaceStore, setFindAndReplaceStore] = FindAndReplaceStore;
  const docSource = blockSourceSignal.get;

  const IS_SYNC = () => {
    return docSource() && isSourceSyncService(docSource()!);
  };

  const debouncedSaveState = debounce(() => {
    const state_ = state();
    if (!state_ || !canEdit()) return;
    const savableState = getSaveState(editor.getEditorState());
    saveMarkdownDocument(JSON.stringify(savableState));
  }, 500);

  // flush save state after unblocking
  const blockSave = useBlockSave();
  createEffect((prev) => {
    const blockSave_ = blockSave();
    // no save on load
    if (!blockSave_ && prev !== undefined) {
      debouncedSaveState();
    }

    return blockSave_;
  }, undefined);

  let editorContainerRef!: HTMLDivElement;

  const [clickTargetHeight, setClickTargetHeight] = createSignal(0);
  const [isGenerating, setIsGenerating] = isGeneratingSignal;
  const generatedAndWaiting = generatedAndWaitingSignal.get;
  const [generateMenuOpen, _setGenerateMenuOpen] = generateMenuSignal;

  const [editorReady, setEditorReady] = createSignal<boolean>(false);
  const [editorError, setEditorError] = markdownBlockErrorSignal;

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

  const mentionsMenuOperations = createMenuOperations();
  const tagsMenuOperations = createMenuOperations();
  const emojiMenuOperations = createMenuOperations();
  const actionsMenuOperations = createMenuOperations();
  const snippetsMenuOperations = createMenuOperations();

  // store for the drag insert pluign.
  const [dragInsertStore, setDragInsertStore] = createDragInsertStore();

  // store for the draggable block (drag-to-rearrange) plugin.
  const [draggableBlockStore, setDraggableBlockStore] =
    createDraggableBlockStore();

  // set up the solid-dnd stuff
  const droppable = createDroppable(editor._config.namespace, {
    type: 'markdown-editor',
  });

  const [dragDropState, { onDragEnd, onDragMove }] = useDragDropContext() ?? [
    undefined,
    {
      onDragEnd: () => {},
      onDragMove: () => {},
    },
  ];

  // turn the solid dnd events into something we can use.
  const wrapDndEvent = (event: EntityDragEvent) => {
    const currentPos = dragDropState?.active.sensor?.coordinates?.current;
    if (!currentPos) return;
    const mousePos = {
      clientX: currentPos.x,
      clientY: currentPos.y,
    };
    const item = event.draggable.data;
    if (item.type === 'foreign') return;
    const blockName = itemToBlockName(item);
    if (!blockName) return;
    let id = event.draggable.data.id as string;
    if (event.draggable.data.type === 'channel_message') {
      id = event.draggable.data.channelId;
    }
    return {
      id,
      blockName: blockName as BlockName,
      mousePos,
      item,
    };
  };

  const dndDragEnd = async (event: EntityDragEvent) => {
    if (!dragInsertStore.visible) return;
    setDragInsertStore({ visible: false });
    if (!canEdit()) return;

    const res = wrapDndEvent(event);
    if (!res) return;

    if (res.blockName === 'image' || res.blockName === 'video') {
      getDragDropPosition(editor, res.mousePos, true);
      editor.dispatchCommand(INSERT_MEDIA_COMMAND, {
        type: 'dss',
        id: res.id,
        mediaType: res.blockName,
      });
      return;
    }

    if (res.blockName === undefined) return;
    const dragInsertPosition = getValidDragInsertPosition(editor, res.mousePos);
    if (!dragInsertPosition) return;

    const mentionId = await trackMention(blockId, 'document', res.id);

    let blockParams: Record<string, string> | undefined;
    if (res.blockName === 'channel') {
      blockParams = {};
      if (res.item.messageId) {
        blockParams[CHANNEL_PARAMS.message] = res.item.messageId;
      }
      if (res.item.threadId) {
        blockParams[CHANNEL_PARAMS.thread] = res.item.threadId;
      }
    }

    insertDocumentMentionAtDragInsertPosition(editor, dragInsertPosition, {
      documentId: res.id,
      documentName: res.item.name,
      blockName: res.blockName,
      blockParams,
      mentionUuid: mentionId,
      createdAt: Date.now(),
    });
  };

  const dndDragMove = throttle((event: EntityDragEvent) => {
    if (!droppable.isActiveDroppable) {
      return setDragInsertStore({ visible: false });
    }
    const res = wrapDndEvent(event);
    if (!res) return;
    const { mousePos } = res;
    updateDragInsertPreviewFromCoordinates({
      editor,
      coordinates: mousePos,
      setState: setDragInsertStore,
    });
  }, 60);

  onDragEnd((event) => {
    // dndDragMove is a trailing throttle, so a callback scheduled just before
    // the drop would otherwise fire after it and could re-show the indicator.
    dndDragMove.clear();
    // Only soup entity drags insert mentions (not e.g. sidebar favorite drags).
    if (!isEntityDragEvent(event)) return;
    dndDragEnd(event);
  });

  onDragMove((event) => {
    if (!isEntityDragEvent(event)) return;
    dndDragMove(event);
  });

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

  // plugins
  plugins
    .richText()
    .list()
    .markdownShortcuts()
    .delete()
    .state<EditorState>(setState, 'json')
    .history(400, props.loroManager)
    .use(tabIndentationPlugin())
    .use(selectionDataPlugin(lexicalWrapper))
    .use(horizontalRulePlugin())
    .use(
      emojisPlugin({
        menu: emojiMenuOperations,
        peerIdValidator: peerIdValidator(),
      })
    )
    .use(
      mentionsPlugin({
        menu: mentionsMenuOperations,
        peerIdValidator: peerIdValidator(),
        sourceDocumentId: blockId,
      })
    )
    .use(
      tagsPlugin({
        menu: tagsMenuOperations,
        peerIdValidator: peerIdValidator(),
      })
    )
    .use(
      snippetsPlugin({
        menu: snippetsMenuOperations,
        peerIdValidator: peerIdValidator(),
        sourceDocumentId: blockId,
      })
    )
    .use(
      actionsPlugin({
        menu: actionsMenuOperations,
        peerIdValidator: peerIdValidator(),
      })
    )
    .use(mediaPlugin())
    .use(
      tablePlugin({
        hasCellMerge: true,
        hasCellBackgroundColor: true,
        hasTabHandler: true,
        hasHorizontalScroll: true,
      })
    )
    .use(tableCellResizerPlugin())
    .use(tableTouchSelectionPlugin())
    .use(
      filePastePlugin({
        onPasteFilesAndDirs: (fileEntries, directories) =>
          handleFileFolderDrop(
            fileEntries,
            directories,
            createFilesReadyHandler(editor, blockId)
          ),
      })
    )
    .use(
      findAndReplacePlugin({
        getListOffset: () => findAndReplaceStore.listOffset,
        setListOffset: onSetListOffset,
      })
    )
    .use(
      dragInsertPlugin({
        setState: setDragInsertStore,
        dragListenerRef: editorContainerRef,
      })
    )
    .use(textPastePlugin())
    .use(restoreFocusPlugin())
    .use(markdownPastePlugin())
    .use(normalizeEnterPlugin())
    .use(trailingParagraphPlugin())
    .use(
      checkboxToTaskPlugin({
        currentUserId: userId(),
        parentTaskId: blockName === 'task' ? blockId : undefined,
      })
    )
    .use(
      keyboardShortcutsPlugin({
        shortcuts: [
          ...DefaultShortcuts,
          {
            label: `${IS_MAC ? 'meta' : 'ctrl'}+shift+o`,
            test: (e) =>
              e.code === 'KeyO' &&
              e.shiftKey &&
              (IS_MAC ? e.metaKey : e.ctrlKey),
            handler: (editor) => {
              const userId = useUserId()();
              if (!userId) return;
              editor.dispatchCommand(CONVERT_CHECKBOXES_TO_TASKS, {});
            },
            priority: 0,
          },
        ],
      })
    )
    .use(
      documentMetadataPlugin({
        onVersionError: (error) => setEditorError(error),
      })
    )
    .use(pinnedPropertiesPlugin())
    .use(awaitPlugin());

  if (isIOS || isNativeMobilePlatform()) {
    plugins.use(
      iosCursorScrollPlugin({ scrollContainer: () => md.scrollContainer })
    );
  }

  if (ENABLE_MARKDOWN_LIVE_COLLABORATION) {
    const peerId = () => props.loroManager.peerIdStr;
    plugins.use(
      peerIdPlugin({
        peerId,
        nodes: [InlineSearchNode, CommentNode, AwaitNode],
      })
    );
  }

  if (ENABLE_MARKDOWN_DIFF) {
    plugins.use(
      diffPlugin({
        revisionsSignal: revisionsSignal,
        nodeIdMap: lexicalWrapper.mapping!,
      })
    );
  }

  const [accessoryStore, setAccessoryStore] = createAccessoryStore();
  if (ENABLE_MARKDOWN_AI_GENERATE) {
    plugins.use(
      generatePlugin({
        completionSignal: completionSignal,
        isGeneratingSignal,
        generatedAndWaitingSignal,
        menuSignal: generateMenuSignal,
        setContext: generateContextSignal[1],
        accessories: accessoryStore,
        setAccessories: setAccessoryStore,
      })
    );
  }
  plugins.use(
    codePlugin({
      accessories: accessoryStore,
      setAccessories: setAccessoryStore,
    })
  );
  plugins.use(listToTablePlugin());

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
    plugins.use(
      dragInsertPlugin({
        setState: setDragInsertStore,
        dragListenerRef: editorContainerRef,
      })
    );
    plugins.use(
      draggableBlockPlugin({
        setState: setDraggableBlockStore,
        anchorElem: editorContainerRef,
      })
    );

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
    return (
      mentionsMenuOperations.isOpen() ||
      emojiMenuOperations.isOpen() ||
      actionsMenuOperations.isOpen() ||
      snippetsMenuOperations.isOpen() ||
      titleEditorMenuOpen()
    );
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
    const file = blockFileSignal();
    if (!file) return;

    file.arrayBuffer().then(setFileArrayBuffer);
  });

  createEffect(() => {
    const source = docSource();
    if (!source) return;
    if (!isSourceDSS(source)) return;
    if (!blockData()) return;
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

  const _generateContentCallback = createCallback((userRequest: string) => {
    setIsGenerating(true);
    generateContentCallback(userRequest);
  });

  const setRewriteSignal = rewriteSignal.set;
  const setRevisionSignal = revisionsSignal.set;

  createMethodRegistration(blockHandle, {
    setPatches: (args: { patches: MarkdownRewriteOutput['diffs'] }) => {
      setRewriteSignal(false);
      setRevisionSignal(args.patches);
    },
  });

  createMethodRegistration(blockHandle, {
    setIsRewriting: () => {
      setRewriteSignal(true);
    },
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
        class="relative mt-1.5"
        ref={editorContainerRef}
        use:fileFolderDrop={{
          onDrop: (fileEntries, folderEntries, e) => {
            if (!e) return;
            handleFileFolderDrop(
              fileEntries,
              folderEntries,
              createFilesReadyHandler(editor, blockId, 'md', () =>
                getDragDropPosition(editor, e, true)
              )
            );
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
        <DecoratorRenderer editor={editor} />
        <NodeAccessoryRenderer editor={editor} store={accessoryStore} />

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

        <DragInsertIndicator
          state={dragInsertStore}
          active={canEdit() ?? false}
        />

        <DraggableBlockMenu
          state={draggableBlockStore}
          setState={setDraggableBlockStore}
          active={canEdit() ?? false}
        />

        <EmojiMenu
          editor={editor}
          menu={emojiMenuOperations}
          useBlockBoundary={true}
        />

        <MentionsMenu
          editor={editor}
          menu={mentionsMenuOperations}
          useBlockBoundary={true}
          showOpenTabs
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

        <SnippetsMenu
          editor={editor}
          menu={snippetsMenuOperations}
          useBlockBoundary={true}
          sourceDocumentId={blockId}
        />

        <ActionMenu
          editor={editor}
          menu={actionsMenuOperations}
          actionContext={{
            sourceDocumentId: blockId,
            sourceBlockName: blockName,
          }}
        />

        <FloatingMenuGroup>
          <FloatingLinkMenu autoLinkMatchMode="common-tlds" />
          <FloatingEquationMenu />
          <FloatingTableMenu />
          <MarkdownPopup
            highlightLayerRef={highlightLayerRef() ?? editorContainerRef}
            lexicalMapping={lexicalWrapper.mapping}
          />
        </FloatingMenuGroup>

        <Show when={FindAndReplaceStore.get.searchIsOpen}>
          <SearchHighlight
            anchorElem={highlightLayerRef() ?? editorContainerRef}
          />
          <FloatingSearchHighlight
            anchorElem={highlightLayerRef() ?? editorContainerRef}
          />
        </Show>

        <Show when={ENABLE_MARKDOWN_COMMENTS}>
          <CommentsProvider
            activeComment={activeCommentIdParam}
            loroManager={props.loroManager}
          />
        </Show>

        <Show when={canEdit()}>
          {/* On touch devices the hover-driven controls are unusable */}
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

        <Show when={ENABLE_MARKDOWN_AI_GENERATE}>
          <GenerateMenu
            generateCallback={_generateContentCallback}
            menuOpen={generateMenuSignal}
            completionSignal={completionSignal[0]}
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
