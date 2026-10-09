/**
 * @file The general editing features of a markdown document editor: block
 * types, inline menus, tables, code, media, file paste and drop, and block
 * dragging. Document editors and collaborative surfaces register the same set.
 * Features that belong to a document (tags, find and replace, pinned
 * properties, diff, AI generation) plug into named slots, so the registration
 * order stays the document editor's.
 */

import type { BlockName } from '@core/block';
import { IS_MAC } from '@core/constant/isMac';
import { useUserId } from '@core/context/user';
import { handleFileFolderDrop } from '@core/util/upload';
import {
  AwaitNode,
  CommentNode,
  InlineSearchNode,
  type PeerIdValidator,
  peerIdPlugin,
} from '@macro-inc/lexical-core';
import type { Accessor } from 'solid-js';
import type { MarkdownEditorErrors } from '../constants';
import type { LexicalWrapper } from '../context/LexicalWrapperContext';
import {
  awaitPlugin,
  createDraggableBlockStore,
  createDragInsertStore,
  DefaultShortcuts,
  documentMetadataPlugin,
  draggableBlockPlugin,
  dragInsertPlugin,
  filePastePlugin,
  horizontalRulePlugin,
  keyboardShortcutsPlugin,
  listSwipeIndentPlugin,
  listToTablePlugin,
  markdownPastePlugin,
  mentionsPlugin,
  type PluginFunction,
  selectionDataPlugin,
  tabIndentationPlugin,
  tableCellResizerPlugin,
  tablePlugin,
  tableTouchSelectionPlugin,
  textPastePlugin,
  trailingParagraphPlugin,
} from '../plugins';
import { actionsPlugin } from '../plugins/actions/actionsPlugin';
import { blockDecoratorNavigationPlugin } from '../plugins/block-decorator-navigation';
import {
  CONVERT_CHECKBOXES_TO_TASKS,
  checkboxToTaskPlugin,
} from '../plugins/checkbox-to-task';
import { createChecklistControls } from '../plugins/checklist-controls';
import { codePlugin } from '../plugins/code/codePlugin';
import { emojisPlugin } from '../plugins/emojis/emojisPlugin';
import { iosCursorScrollPlugin } from '../plugins/ios-cursor-scroll';
import { mediaPlugin } from '../plugins/media';
import { createAccessoryStore } from '../plugins/node-accessory';
import { normalizeEnterPlugin } from '../plugins/normalize-enter/';
import { restoreFocusPlugin } from '../plugins/restore-focus';
import { snippetsPlugin } from '../plugins/snippets';
import type { MentionLinkResolver } from '../plugins/text-paste/textPastePlugin';
import { createMenuOperations } from '../shared/inlineMenu';
import {
  createFilesReadyHandler,
  getDragDropPosition,
} from '../utils/fileUploadUtils';

/** Where the edited content lives. */
export type MarkdownEditingSource = {
  /** The document or surface id: the source of snippets and mentions. */
  id: string;
  /** The block hosting the editor, for actions such as the slash task. */
  blockName?: string;
  /**
   * Record inserted mentions as references from this source. Only documents
   * are mention sources, so other surfaces insert untracked mentions.
   */
  trackMentions: boolean;
};

type AccessoryStoreSignal = ReturnType<typeof createAccessoryStore>;

/** Document features registered at fixed points of the shared chain. */
export type MarkdownEditingSlots = {
  /** After mentions, e.g. tags. */
  afterMentions?: PluginFunction[];
  /** After file paste, e.g. find and replace. */
  afterFilePaste?: PluginFunction[];
  /** Before the await plugin, e.g. pinned properties. */
  beforeAwait?: PluginFunction[];
  /** Before code blocks, sharing their node accessories, e.g. diff and AI generation. */
  beforeCode?: (accessories: AccessoryStoreSignal) => PluginFunction[];
};

export type MarkdownEditingOptions = {
  lexicalWrapper: LexicalWrapper;
  isContentEditable: Accessor<boolean>;
  /** Keeps this peer from committing another peer's in-flight inline nodes. */
  peerIdValidator: PeerIdValidator;
  source: MarkdownEditingSource;
  resolveAppLink?: MentionLinkResolver;
  /** Checklist items converted to tasks become subtasks of this task. */
  parentTaskId?: string;
  onVersionError: (error: MarkdownEditorErrors) => void;
  /** The local collaboration peer, for collaborative editors. */
  peerId?: () => string;
  /** On iOS, keeps the caret visible inside this scroll container. */
  iosScrollContainer?: () => HTMLElement | undefined;
  slots?: MarkdownEditingSlots;
};

/** Register the general editing features after the base rich-text plugins. */
export function registerMarkdownEditing(options: MarkdownEditingOptions) {
  const { lexicalWrapper, peerIdValidator, source, slots } = options;
  const { editor, plugins } = lexicalWrapper;
  const userId = useUserId();
  const filesBlockId = source.trackMentions ? source.id : undefined;

  const menus = {
    emoji: createMenuOperations(),
    mentions: createMenuOperations(),
    actions: createMenuOperations(),
    snippets: createMenuOperations(),
  };
  const dragInsert = createDragInsertStore();
  const draggableBlock = createDraggableBlockStore();
  const accessories = createAccessoryStore();
  const [, setDragInsertStore] = dragInsert;
  const [, setDraggableBlockStore] = draggableBlock;
  const [accessoryStore, setAccessoryStore] = accessories;
  let container: HTMLDivElement | undefined;

  const useAll = (pluginFns: PluginFunction[] | undefined) => {
    for (const pluginFn of pluginFns ?? []) plugins.use(pluginFn);
  };

  plugins
    .use(tabIndentationPlugin())
    .use(listSwipeIndentPlugin(options.isContentEditable))
    .use(selectionDataPlugin(lexicalWrapper))
    .use(horizontalRulePlugin())
    .use(emojisPlugin({ menu: menus.emoji, peerIdValidator }))
    .use(
      mentionsPlugin({
        menu: menus.mentions,
        peerIdValidator,
        sourceDocumentId: source.id,
        disableMentionTracking: !source.trackMentions,
      })
    );
  useAll(slots?.afterMentions);
  plugins
    .use(
      snippetsPlugin({
        menu: menus.snippets,
        peerIdValidator,
        sourceDocumentId: source.id,
      })
    )
    .use(actionsPlugin({ menu: menus.actions, peerIdValidator }))
    .use(mediaPlugin())
    .use(blockDecoratorNavigationPlugin())
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
            createFilesReadyHandler(editor, filesBlockId)
          ),
      })
    );
  useAll(slots?.afterFilePaste);
  plugins
    .use(
      dragInsertPlugin({
        setState: setDragInsertStore,
        dragListenerRef: container,
      })
    )
    .use(textPastePlugin(options.resolveAppLink))
    .use(restoreFocusPlugin())
    .use(markdownPastePlugin())
    .use(normalizeEnterPlugin())
    .use(trailingParagraphPlugin())
    .use(
      checkboxToTaskPlugin({
        currentUserId: userId(),
        parentTaskId: options.parentTaskId,
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
    .use(documentMetadataPlugin({ onVersionError: options.onVersionError }));
  useAll(slots?.beforeAwait);
  plugins.use(awaitPlugin());

  if (options.iosScrollContainer) {
    plugins.use(
      iosCursorScrollPlugin({ scrollContainer: options.iosScrollContainer })
    );
  }
  if (options.peerId) {
    plugins.use(
      peerIdPlugin({
        peerId: options.peerId,
        nodes: [InlineSearchNode, CommentNode, AwaitNode],
      })
    );
  }
  useAll(slots?.beforeCode?.(accessories));
  const checklistControls = createChecklistControls();
  plugins
    .use(
      codePlugin({
        accessories: accessoryStore,
        setAccessories: setAccessoryStore,
      })
    )
    .use(checklistControls.plugin)
    .use(listToTablePlugin());

  return {
    menus,
    dragInsert,
    draggableBlock,
    accessories,
    checklistControls: checklistControls.data,
    /** Whether an inline menu owns the arrow and enter keys. */
    isInlineMenuOpen: () =>
      menus.mentions.isOpen() ||
      menus.emoji.isOpen() ||
      menus.actions.isOpen() ||
      menus.snippets.isOpen(),
    /** Register the plugins that track drags over the editor's container. */
    connectContainer(element: HTMLDivElement) {
      container = element;
      plugins.use(
        dragInsertPlugin({
          setState: setDragInsertStore,
          dragListenerRef: element,
        })
      );
      plugins.use(
        draggableBlockPlugin({
          setState: setDraggableBlockStore,
          anchorElem: element,
        })
      );
    },
    /** Upload files dropped on the editor and insert them at the drop point. */
    dropFiles(
      fileEntries: FileSystemFileEntry[],
      folderEntries: FileSystemDirectoryEntry[],
      event: DragEvent,
      blockName?: BlockName
    ) {
      handleFileFolderDrop(
        fileEntries,
        folderEntries,
        createFilesReadyHandler(editor, filesBlockId, blockName, () =>
          getDragDropPosition(editor, event, true)
        )
      );
    },
  };
}

export type MarkdownEditing = ReturnType<typeof registerMarkdownEditing>;
