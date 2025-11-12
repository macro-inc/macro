import { CommentsProvider } from '@block-md/comments/CommentsProvider';
import { keyNavigationPlugin } from '@block-md/plugins/keyboardNavigation';
import { markdownBlockErrorSignal } from '@block-md/signal/error';
import { FindAndReplaceStore } from '@block-md/signal/findAndReplaceStore';
import { revisionsSignal, rewriteSignal } from '@block-md/signal/rewriteSignal';
import { type BlockName, useBlockId } from '@core/block';
import type { DragEventWithData } from '@core/component/FileList/DraggableItem';
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
import { GenerateMenu } from '@core/component/LexicalMarkdown/component/menu/GenerateMenu';
import { MentionsMenu } from '@core/component/LexicalMarkdown/component/menu/MentionsMenu';
import TableActionMenu, {
  anchorElemRefSignal,
  menuButtonRefSignal,
  tableCellNodeKeySignal,
} from '@core/component/LexicalMarkdown/component/menu/TableActionMenu';
import { DragInsertIndicator } from '@core/component/LexicalMarkdown/component/misc/DragInsertIndicator';
import { TableCellResizer } from '@core/component/LexicalMarkdown/component/misc/TableCellResizer';
import { Wordcount } from '@core/component/LexicalMarkdown/component/status/Wordcount';
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
  CLOSE_INLINE_SEARCH_COMMAND,
  calculateInsertPoint,
  createDragInsertStore,
  createWordcountStatsStore,
  DefaultShortcuts,
  diffPlugin,
  documentMetadataPlugin,
  dragInsertPlugin,
  filePastePlugin,
  generatePlugin,
  horizontalRulePlugin,
  keyboardShortcutsPlugin,
  markdownPastePlugin,
  mentionsPlugin,
  pinnedPropertiesPlugin,
  SET_SELECTION_AT_INSERTION,
  selectionDataPlugin,
  tabIndentationPlugin,
  tableActionMenuPlugin,
  tableCellResizerPlugin,
  tablePlugin,
  textPastePlugin,
  wordcountPlugin,
} from '@core/component/LexicalMarkdown/plugins';
import { actionsPlugin } from '@core/component/LexicalMarkdown/plugins/actions/actionsPlugin';
import { codePlugin } from '@core/component/LexicalMarkdown/plugins/code/codePlugin';
import { emojisPlugin } from '@core/component/LexicalMarkdown/plugins/emojis/emojisPlugin';
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
  addMediaFromFile,
  INSERT_MEDIA_COMMAND,
  mediaPlugin,
} from '@core/component/LexicalMarkdown/plugins/media';
import { createAccessoryStore } from '@core/component/LexicalMarkdown/plugins/node-accessory';
import { useUserPromptPlugin } from '@core/component/LexicalMarkdown/plugins/userPrompt';
import { createMenuOperations } from '@core/component/LexicalMarkdown/shared/inlineMenu';
import {
  $insertWrappedAfter,
  $insertWrappedBefore,
  editorFocusSignal,
  editorIsEmpty,
  getSaveState,
  initializeEditorEmpty,
  initializeEditorWithState,
  setEditorStateFromMarkdown,
} from '@core/component/LexicalMarkdown/utils';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { toast } from '@core/component/Toast/Toast';
import {
  blockNameToFileExtensions,
  blockNameToMimeTypes,
  fileTypeToBlockName,
} from '@core/constant/allBlocks';
import {
  ENABLE_MARKDOWN_COMMENTS,
  ENABLE_MARKDOWN_DIFF,
  ENABLE_MARKDOWN_LIVE_COLLABORATION,
  LOCAL_ONLY,
} from '@core/constant/featureFlags';
import { fileDrop } from '@core/directive/fileDrop';
import { HEIC_EXTENSIONS, HEIC_MIME_TYPES } from '@core/heic/constants';
import { blockElementSignal } from '@core/signal/blockElement';
import {
  blockFileSignal,
  blockHandleSignal,
  blockLoroManagerSignal,
  blockSourceSignal,
} from '@core/signal/load';
import { trackMention } from '@core/signal/mention';
import { useCanComment, useCanEdit } from '@core/signal/permissions';
import { isSourceDSS, isSourceSyncService } from '@core/util/source';
import { bufToString } from '@core/util/string';
import WarningIcon from '@icon/regular/warning.svg';
import {
  $createDocumentMentionNode,
  $isInlineSearchNode,
  CommentNode,
  createPeerIdValidator,
  InlineSearchNode,
  type PeerIdValidator,
  peerIdPlugin,
} from '@lexical-core';
import type { MarkdownRewriteOutput } from '@service-cognition/generated/tools/types';
import { fileExtension } from '@service-storage/util/filename';
import { createCallback } from '@solid-primitives/rootless';
import { debounce, throttle } from '@solid-primitives/scheduled';
import { useSearchParams } from '@solidjs/router';
import { createDroppable, useDragDropContext } from '@thisbeyond/solid-dnd';
import { normalizeEnterPlugin } from 'core/component/LexicalMarkdown/plugins/normalize-enter/';
import {
  autoRegister,
  lazyRegister,
  registerRootEventListener,
} from 'core/component/LexicalMarkdown/plugins/shared/utils';
import { createMethodRegistration } from 'core/orchestrator';
import { $getRoot, $isElementNode, type EditorState } from 'lexical';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
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
import { useBlockSave, useSaveMarkdownDocument } from '../signal/save';
import { MarkdownCollabProvider } from './MarkdownCollabProvider';
import { MarkdownPopup } from './MarkdownPopup';

false && fileDrop;

const DEBUG = LOCAL_ONLY;

// There is an invisible div below the editor that clicks to set editor focus
// and add a new line. This constant is the minimum height of that element (in pixels)
// once the editor has at least one full page of content.
const EDITOR_PADDING_BOTTOM = 200;

const DRAG_EVENT_PADDING = 8;

export function MarkdownEditor() {
  const blockData = blockDataSignal.get;
  const blockId = useBlockId();

  const saveMarkdownDocument = useSaveMarkdownDocument();
  const setMdStore = mdStore.set;
  const md = mdStore.get;
  const canEdit = useCanEdit();
  const canComment = useCanComment();
  const [blockElement] = blockElementSignal;
  const [locationParams, setPendingLocationParams] =
    createSignal<Record<string, string>>();
  const [findAndReplaceStore, setFindAndReplaceStore] = FindAndReplaceStore;
  const docSource = blockSourceSignal.get;

  const IMAGE_EXTENSIONS_HEIC = [
    ...blockNameToFileExtensions.image,
    ...HEIC_EXTENSIONS,
  ];
  const IMAGE_MIME_TYPES_HEIC = [
    ...blockNameToMimeTypes.image,
    ...HEIC_MIME_TYPES,
  ];
  const VIDEO_EXTENSIONS = blockNameToFileExtensions.video;
  const VIDEO_MIME_TYPES = blockNameToMimeTypes.video;

  const blockHandle = blockHandleSignal.get;
  createMethodRegistration(blockHandle, {
    goToLocationFromParams: (params: Record<string, any>) => {
      setPendingLocationParams({ ...params });
    },
  });

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

  let mountRef!: HTMLDivElement;
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
    editor.setEditable(canEdit() || canComment());
  });

  const isContentEditable = createMemo(() => {
    return (
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

  let [state, setState] = createSignal<EditorState>(editor.getEditorState());

  setMdStore('editor', editor);
  setMdStore('plugins', plugins);
  const [editorFocus, setEditorFocus] = createSignal(false);
  editorFocusSignal(editor, setEditorFocus);

  const mentionsMenuOperations = createMenuOperations();
  const emojiMenuOperations = createMenuOperations();
  const actionsMenuOperations = createMenuOperations();

  const getDragDropPosition = (
    e: DragEvent | { clientX: number; clientY: number },
    setSelection = false
  ) => {
    const { key, position } = calculateInsertPoint(
      editor,
      e,
      DRAG_EVENT_PADDING
    );
    if (setSelection && key !== null && position !== null) {
      editor.dispatchCommand(SET_SELECTION_AT_INSERTION, [key, position]);
    }
    return { key, position };
  };

  // handler for the file paste directive
  const onPasteFiles = async (files: File[]) => {
    for (const file of files) {
      const ext = fileExtension(file.name);

      let success = false;

      if (ext != null && IMAGE_EXTENSIONS_HEIC.includes(ext)) {
        const res = await addMediaFromFile(editor, file, 'image');
        success = res.success;
      } else if (ext != null && VIDEO_EXTENSIONS.includes(ext)) {
        const res = await addMediaFromFile(editor, file, 'video');
        success = res.success;
      }

      if (!success) {
        toast.failure('Invalid attachment file(s)');
      }
    }
  };

  // handler for the file drop directive - file paste plus calc drop pos.
  const onDropFiles = (files: File[], e: DragEvent) => {
    getDragDropPosition(e, true);
    onPasteFiles(files);
  };

  // store for the drag insert pluign.
  const [dragInsertStore, setDragInsertStore] = createDragInsertStore();

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
  const wrapDndEvent = (event: DragEventWithData) => {
    const currentPos = dragDropState?.active.sensor?.coordinates?.current;
    if (!currentPos) return;
    const mousePos = {
      clientX: currentPos.x,
      clientY: currentPos.y,
    };
    const item = event.draggable.data;
    const blockName = fileTypeToBlockName(item.fileType ?? item.type);
    if (!blockName) return;
    return {
      id: event.draggable.data.id as string,
      blockName: blockName as BlockName,
      mousePos,
      item,
    };
  };

  const dndDragEnd = async (event: DragEventWithData) => {
    if (!dragInsertStore.visible) return;
    setDragInsertStore({ visible: false });
    if (!canEdit()) return;

    const res = wrapDndEvent(event);
    if (!res) return;
    const { key, position } = getDragDropPosition(res.mousePos, true);

    if (res.blockName === 'image' || res.blockName === 'video') {
      editor.dispatchCommand(INSERT_MEDIA_COMMAND, {
        type: 'dss',
        id: res.id,
        mediaType: res.blockName,
      });
      return;
    }

    if (res.blockName === undefined) return;
    if (!key || !position) return;

    const mentionId = await trackMention(blockId, 'document', res.id);

    editor.update(() => {
      const mention = $createDocumentMentionNode({
        documentId: res.id,
        documentName: res.item.name,
        blockName: res.blockName,
        mentionUuid: mentionId,
      });

      if (position === 'before') {
        $insertWrappedBefore(key, mention);
      } else {
        $insertWrappedAfter(key, mention);
      }
      mention.selectEnd();
    });
  };

  const dndDragMove = throttle((event: DragEventWithData) => {
    if (!droppable.isActiveDroppable) {
      return setDragInsertStore({ visible: false });
    }
    const res = wrapDndEvent(event);
    if (!res) return;
    const { mousePos } = res;
    const { key, position } = getDragDropPosition(mousePos, false);
    if (key !== null && position !== null) {
      setDragInsertStore({ nodeKey: key, position, visible: true });
    }
  }, 60);

  onDragEnd((event) => {
    dndDragEnd(event as DragEventWithData);
  });

  onDragMove((event) => {
    dndDragMove(event as DragEventWithData);
  });

  // handler for the find and replace directive
  const onSetListOffset = (listOffset: NodekeyOffset[]) => {
    setFindAndReplaceStore('listOffset', listOffset);
    if (
      findAndReplaceStore.currentMatch >= findAndReplaceStore.listOffset.length
    ) {
      setFindAndReplaceStore('currentMatch', 0);
    }
  };

  const [highlightNodeId, setHighlightNodeId] = createSignal<string>();
  const [searchParams] = useSearchParams();
  const derivedSearchParams = createMemo(() => {
    return {
      ...searchParams,
      ...locationParams(),
    };
  });

  const [activeLocation, setActiveLocation] =
    createSignal<PersistentLocation>();
  const [locationReady, setLocationReady] = createSignal(false);

  createEffect(() => {
    let nodeId = derivedSearchParams().node_id;
    if (Array.isArray(nodeId)) {
      nodeId = nodeId.length > 0 ? nodeId[0] : undefined;
    }
    if (typeof nodeId === 'string' && nodeId) {
      setHighlightNodeId(nodeId);
    }

    const location = derivedSearchParams().location;
    if (location && typeof location === 'string') {
      const locationObj = parsePersistentLocation(location);
      if (locationObj) {
        setActiveLocation(locationObj);
      }
    }
  });

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
    if (highlightNodeId_ && editorReady()) {
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

  const tableActionsMenuPluginProps = {
    menuButtonRef: menuButtonRefSignal.get,
    anchorElem: anchorElemRefSignal.get,

    tableCellNodeKey: tableCellNodeKeySignal.get,
    setTableCellNodeKey: (cellNodeKey: string | null) => {
      tableCellNodeKeySignal.set(cellNodeKey ?? undefined);
    },
  };

  const peerIdValidator: Accessor<PeerIdValidator> = () => {
    if (!IS_SYNC()) {
      return createPeerIdValidator(() => undefined, false);
    }
    const loroManager = blockLoroManagerSignal.get;
    const peerId = () => loroManager()?.getPeerIdStr();
    return createPeerIdValidator(peerId, true);
  };

  // plugins
  plugins
    .richText()
    .list()
    .markdownShortcuts()
    .delete()
    .state<EditorState>(setState, 'json')
    .history(400)
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
    .use(tableActionMenuPlugin(tableActionsMenuPluginProps))
    .use(filePastePlugin({ onPaste: onPasteFiles }))
    .use(
      findAndReplacePlugin({
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
    .use(markdownPastePlugin())
    .use(normalizeEnterPlugin())
    .use(
      keyboardShortcutsPlugin({
        shortcuts: DefaultShortcuts,
      })
    )
    .use(
      documentMetadataPlugin({
        onVersionError: (error) => setEditorError(error),
      })
    )
    .use(pinnedPropertiesPlugin());

  if (ENABLE_MARKDOWN_LIVE_COLLABORATION) {
    const getBlockLoroManager = blockLoroManagerSignal.get;
    const peerId = () => getBlockLoroManager()?.getPeerIdStr();
    plugins.use(
      peerIdPlugin({ peerId, nodes: [InlineSearchNode, CommentNode] })
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
  plugins.use(
    codePlugin({
      accessories: accessoryStore,
      setAccessories: setAccessoryStore,
    })
  );

  onMount(() => {
    setMdStore('selection', lexicalWrapper.selection);
    editor.setRootElement(mountRef);

    // Register this plugin once we have the ref.
    plugins.use(
      dragInsertPlugin({
        setState: setDragInsertStore,
        dragListenerRef: editorContainerRef,
      })
    );

    // watch the height of the content editable to set the height of
    // the focus target
    const editorRefObserver = new ResizeObserver(() => {
      const blockEl = blockElement();
      if (!blockEl) {
        setClickTargetHeight(EDITOR_PADDING_BOTTOM);
        return;
      }
      const blockBottom =
        blockEl?.getBoundingClientRect().bottom ?? window.innerHeight;

      const targetHeight =
        blockBottom - mountRef.getBoundingClientRect().bottom - 40;
      setClickTargetHeight(Math.max(targetHeight, EDITOR_PADDING_BOTTOM));
    });

    editorRefObserver.observe(mountRef);
    onCleanup(() => {
      editorRefObserver.disconnect();
    });
  });

  // better focus in handling. preserves selection on regain focus!
  autoRegister(
    registerRootEventListener(editor, 'focusin', (e) => {
      e.preventDefault();
      editor.focus(undefined, { defaultSelection: 'rootStart' });
    })
  );

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
      titleEditorMenuOpen()
    );
  });

  createEffect(() => {
    // We still want the editor to be locked down (for certain things like click events on check
    // lists) when the user does not have editor access.
    editor.setEditable(canEdit() ?? false);
  });

  createEffect(() => {
    const titleEditor = md.titleEditor;
    if (!titleEditor) return;
    plugins.use(keyNavigationPlugin(titleEditor, isInlineMenuOpen));
  });

  const [editorHasNoContent, setEditorHasNoContent] = createSignal(false);

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

  // handle updates to the highlights if the document is modified
  additionalCleanups.push(
    editor.registerUpdateListener(() => {
      if (
        findAndReplaceStore.searchIsOpen &&
        findAndReplaceStore.searchInputText
      ) {
        editor.dispatchCommand(
          DO_SEARCH_COMMAND,
          findAndReplaceStore.searchInputText
        );
      }
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

  const [wordcountStats, setWordcountStats] = createWordcountStatsStore();
  plugins.use(
    wordcountPlugin({ setStore: setWordcountStats, debounceTime: 200 })
  );

  return (
    <LexicalWrapperContext.Provider value={lexicalWrapper}>
      {/* SCUFFED: are these the right transparency values? */}
      <Show when={editorError()}>
        {(error) => (
          <div class="pointer-events-none text-alert-ink p-2 bg-alert-bg w-full border-alert/30 border-1 mb-2 flex items-center gap-2">
            <WarningIcon class="size-6 shrink-0" />
            {getErrorDescription(error())}
          </div>
        )}
      </Show>
      <div
        class="relative"
        ref={editorContainerRef}
        use:fileDrop={{
          acceptedMimeTypes: [...IMAGE_MIME_TYPES_HEIC, ...VIDEO_MIME_TYPES],
          acceptedFileExtensions: [
            ...IMAGE_EXTENSIONS_HEIC,
            ...VIDEO_EXTENSIONS,
          ],
          onDrop: (files, event) => {
            onDropFiles(files, event);
          },
          multiple: true,
        }}
        use:droppable
      >
        <div
          ref={mountRef}
          contentEditable={isContentEditable()}
          class="w-full max-w-full"
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
          />
        </Show>

        <FocusClickTarget
          editor={editor}
          editorFocus={editorFocus}
          style={{ height: `${clickTargetHeight()}px` }}
        />
        <Show when={isBlankMarkdown()}>
          <div class="pointer-events-none text-ink-placeholder absolute top-0">
            {canEdit()
              ? `Press '/' for commands, '@' to reference files, 'space' for AI writing...`
              : `This document is blank...`}
          </div>
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

        <EmojiMenu
          editor={editor}
          menu={emojiMenuOperations}
          useBlockBoundary={true}
        />

        <MentionsMenu
          editor={editor}
          menu={mentionsMenuOperations}
          useBlockBoundary={true}
          emails={() => []}
        />

        <ActionMenu editor={editor} menu={actionsMenuOperations} />

        <FloatingMenuGroup>
          <FloatingLinkMenu />
          <FloatingEquationMenu />
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
          <CommentsProvider />
        </Show>

        <ScopedPortal scope="block">
          <Show when={!isBlankMarkdown()}>
            <div class="absolute bottom-2 left-2 w-fit h-fit">
              <Wordcount stats={wordcountStats} />
            </div>
          </Show>
          {/* <Show
            when={
              isBlankMarkdown() &&
              titleIsEmpty() &&
              !isMobileWidth() &&
              isContentEditable()
            }
          >
            <div
              class="absolute bottom-0 left-0 right-0 flex justify-center items-end
                  p-4 w-full overflow-auto"
            >
              <div class="w-full max-w-sm sm:max-w-md lg:max-w-3xl">
                <TemplateSelector
                  titleEditor={md.titleEditor}
                  editor={editor}
                  editorContainerRef={editorContainerRef}
                />
              </div>
            </div>
          </Show> */}
        </ScopedPortal>

        <Show when={canEdit()}>
          <TableCellResizer />
          <TableActionMenu anchorElem={editorContainerRef} cellMerge={true} />
        </Show>

        <GenerateMenu
          generateCallback={_generateContentCallback}
          menuOpen={generateMenuSignal}
          completionSignal={completionSignal[0]}
          editor={editor}
        />

        <Show when={DEBUG}>
          <Show when={state()}>
            {(state) => (
              <LexicalStateDebugger state={state()}></LexicalStateDebugger>
            )}
          </Show>
        </Show>

        {/*<Show when={ENABLE_MARKDOWN_DIFF}>
          <RewritePopup />
        </Show>*/}
      </div>
    </LexicalWrapperContext.Provider>
  );
}

// markdown editor for instructions.md
export function InstructionsMarkdownEditor() {
  const blockData = blockDataSignal.get;
  const blockId = useBlockId();

  const saveMarkdownDocument = useSaveMarkdownDocument();
  const setMdStore = mdStore.set;
  const canEdit = useCanEdit();
  const [blockElement] = blockElementSignal;
  const docSource = blockSourceSignal.get;

  const blockHandle = blockHandleSignal.get;
  createMethodRegistration(blockHandle, {
    goToLocationFromParams: (_params: Record<string, any>) => {},
  });

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

  let mountRef!: HTMLDivElement;
  let editorContainerRef!: HTMLDivElement;

  const [clickTargetHeight, setClickTargetHeight] = createSignal(0);

  const [editorReady, setEditorReady] = createSignal<boolean>(false);
  const [editorError, setEditorError] = markdownBlockErrorSignal;

  createEffect(() => {
    // We still want the editor to be locked down (for certain things like click events on check
    // lists) when the user does not have editor access.
    editor.setEditable(canEdit());
  });

  const isContentEditable = createMemo(() => {
    return (canEdit() ?? false) && !editorError();
  });

  const lexicalWrapper = createLexicalWrapper({
    type: 'markdown-sync',
    namespace: 'block-md-instructions',
    isInteractable: isContentEditable,
    withIds: true,
  });

  const { editor, plugins, cleanup: cleanupPlugins } = lexicalWrapper;

  let [state, setState] = createSignal<EditorState>(editor.getEditorState());

  setMdStore('editor', editor);
  setMdStore('plugins', plugins);
  const [editorFocus, setEditorFocus] = createSignal(false);
  editorFocusSignal(editor, setEditorFocus);

  const mentionsMenuOperations = createMenuOperations();
  const emojiMenuOperations = createMenuOperations();

  const peerIdValidator: Accessor<PeerIdValidator> = () => {
    if (!IS_SYNC()) {
      return createPeerIdValidator(() => undefined, false);
    }
    const loroManager = blockLoroManagerSignal.get;
    const peerId = () => loroManager()?.getPeerIdStr();
    return createPeerIdValidator(peerId, true);
  };

  const userPromptPlugin = useUserPromptPlugin({
    documentId: blockId,
  });

  // plugins
  plugins
    .richText()
    .list()
    .markdownShortcuts()
    .delete()
    .state<EditorState>(setState, 'json')
    .history(400)
    .use(userPromptPlugin)
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
        disableMentionTracking: true,
      })
    )
    .use(textPastePlugin())
    .use(markdownPastePlugin())
    .use(
      keyboardShortcutsPlugin({
        shortcuts: DefaultShortcuts,
      })
    )
    .use(
      documentMetadataPlugin({
        onVersionError: (error) => setEditorError(error),
      })
    );

  if (ENABLE_MARKDOWN_LIVE_COLLABORATION) {
    const getBlockLoroManager = blockLoroManagerSignal.get;
    const peerId = () => getBlockLoroManager()?.getPeerIdStr();
    plugins.use(
      peerIdPlugin({ peerId, nodes: [InlineSearchNode, CommentNode] })
    );
  }

  onMount(() => {
    setMdStore('selection', lexicalWrapper.selection);
    editor.setRootElement(mountRef);

    // watch the height of the content editable to set the height of
    // the focus target
    const editorRefObserver = new ResizeObserver(() => {
      const blockEl = blockElement();
      if (!blockEl) {
        setClickTargetHeight(EDITOR_PADDING_BOTTOM);
        return;
      }
      const blockBottom =
        blockEl?.getBoundingClientRect().bottom ?? window.innerHeight;

      const targetHeight =
        blockBottom - mountRef.getBoundingClientRect().bottom - 40;
      setClickTargetHeight(Math.max(targetHeight, EDITOR_PADDING_BOTTOM));
    });

    editorRefObserver.observe(mountRef);
    onCleanup(() => {
      editorRefObserver.disconnect();
    });
  });

  const additionalCleanups: Array<() => void> = [];

  onCleanup(() => {
    additionalCleanups.forEach((cleanup) => cleanup());
    cleanupPlugins();
  });

  createEffect(() => {
    // We still want the editor to be locked down (for certain things like click events on check
    // lists) when the user does not have editor access.
    editor.setEditable(canEdit() ?? false);
  });

  const [editorHasNoContent, setEditorHasNoContent] = createSignal(false);

  const isBlankMarkdown = createMemo(() => {
    return editorHasNoContent();
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

  // better focus in handling. preserves selection on regain focus!
  autoRegister(
    registerRootEventListener(editor, 'focusin', (e) => {
      e.preventDefault();
      editor.focus();
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

  return (
    <LexicalWrapperContext.Provider value={lexicalWrapper}>
      {/* SCUFFED: are these the right transparency values? */}
      <Show when={editorError()}>
        {(error) => (
          <div class="pointer-events-none text-alert-ink p-2 bg-alert-bg w-full border-alert/30 border-1 mb-2 flex items-center gap-2">
            <WarningIcon class="size-6 shrink-0" />
            {getErrorDescription(error())}
          </div>
        )}
      </Show>
      <div class="relative" ref={editorContainerRef}>
        <div
          ref={mountRef}
          contentEditable={isContentEditable()}
          class="w-full max-w-full"
          classList={{
            'select-auto': !canEdit(),
            'md-no-comments': true,
          }}
        />

        <Show when={IS_SYNC()}>
          <MarkdownCollabProvider
            editor={editor}
            pluginManager={plugins}
            editorContainerRef={editorContainerRef}
            highlighLayerRef={editorContainerRef}
            mappings={lexicalWrapper.mapping!}
            editorFocus={editorFocus}
            setEditorReady={setEditorReady}
            setEditorError={setEditorError}
          />
        </Show>

        <FocusClickTarget
          editor={editor}
          editorFocus={editorFocus}
          style={{ height: `${clickTargetHeight()}px` }}
        />
        <Show when={isBlankMarkdown()}>
          <div class="pointer-events-none text-ink-placeholder absolute top-0">
            {canEdit()
              ? `Enter custom instructions for AI here...`
              : `This document is blank...`}
          </div>
        </Show>

        <DecoratorRenderer editor={editor} />

        <EmojiMenu
          editor={editor}
          menu={emojiMenuOperations}
          useBlockBoundary={true}
        />

        <MentionsMenu
          editor={editor}
          menu={mentionsMenuOperations}
          useBlockBoundary={true}
          disableMentionTracking={true}
          emails={() => []}
        />

        <Show when={DEBUG}>
          <Show when={state()}>
            {(state) => (
              <LexicalStateDebugger state={state()}></LexicalStateDebugger>
            )}
          </Show>
        </Show>
      </div>
    </LexicalWrapperContext.Provider>
  );
}
