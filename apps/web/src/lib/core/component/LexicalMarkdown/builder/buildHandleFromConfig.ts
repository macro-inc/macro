import { handleFileFolderDrop } from '@core/util/upload';
import type { EditorType } from '@macro-inc/lexical-core';
import type { SerializedEditorState } from 'lexical';
import { createSignal } from 'solid-js';
import { createLexicalWrapper } from '../context/LexicalWrapperContext';
import {
  actionsPlugin,
  agentCommandsPlugin,
  awaitPlugin,
  codePlugin,
  createAccessoryStore,
  createDraggableBlockStore,
  createDragInsertStore,
  draggableBlockPlugin,
  dragInsertPlugin,
  emojisPlugin,
  filePastePlugin,
  horizontalRulePlugin,
  keyboardFocusPlugin,
  markdownPastePlugin,
  mediaPlugin,
  mentionsPlugin,
  selectionDataPlugin,
  singleLinePlugin,
  skillsPlugin,
  snippetsPlugin,
  tabIndentationPlugin,
  tagsPlugin,
  textPastePlugin,
} from '../plugins';
import { checkboxToTaskPlugin } from '../plugins/checkbox-to-task';
import { normalizeEnterPlugin } from '../plugins/normalize-enter';
import { restoreFocusPlugin } from '../plugins/restore-focus';
import { createMenuOperations } from '../shared/inlineMenu';
import {
  getSaveState,
  initializeEditorEmpty,
  initializeEditorWithState,
  setEditorStateFromMarkdown,
} from '../utils';
import { createFilesReadyHandler } from '../utils/fileUploadUtils';
import type {
  EditorConfig,
  EditorControls,
  EditorHandle,
  MediaDropOptions,
  MediaOptions,
} from './types';

type InlineMenuOps = {
  actionsMenuOps: ReturnType<typeof createMenuOperations> | undefined;
  mentionsMenuOps: ReturnType<typeof createMenuOperations> | undefined;
  tagsMenuOps: ReturnType<typeof createMenuOperations> | undefined;
  emojisMenuOps: ReturnType<typeof createMenuOperations> | undefined;
  snippetsMenuOps: ReturnType<typeof createMenuOperations> | undefined;
  skillsMenuOps: ReturnType<typeof createMenuOperations> | undefined;
  agentCommandsMenuOps: ReturnType<typeof createMenuOperations> | undefined;
};

type LexicalPlugins = ReturnType<typeof createLexicalWrapper>['plugins'];
type MenuOperations = ReturnType<typeof createMenuOperations>;

function menuIsOpen(ops: MenuOperations | undefined): boolean {
  return ops?.isOpen() ?? false;
}

function isAnyInlineMenuOpen(menuOps: InlineMenuOps): boolean {
  return (
    menuIsOpen(menuOps.actionsMenuOps) ||
    menuIsOpen(menuOps.mentionsMenuOps) ||
    menuIsOpen(menuOps.tagsMenuOps) ||
    menuIsOpen(menuOps.emojisMenuOps) ||
    menuIsOpen(menuOps.snippetsMenuOps) ||
    menuIsOpen(menuOps.skillsMenuOps) ||
    menuIsOpen(menuOps.agentCommandsMenuOps)
  );
}

function createLexicalWrapperForConfig(
  config: EditorConfig,
  isInteractable: () => boolean
) {
  return config.withIds
    ? createLexicalWrapper({
        type: config.type as EditorType,
        namespace: config.namespace,
        isInteractable,
        withIds: true,
      })
    : createLexicalWrapper({
        type: config.type as EditorType,
        namespace: config.namespace,
        isInteractable,
      });
}

function createInlineMenuOps(config: EditorConfig): InlineMenuOps {
  const actionsMenuOps =
    config.actions !== false && config.type !== 'plain-text'
      ? createMenuOperations()
      : undefined;
  const mentionsMenuOps = config.mentions ? createMenuOperations() : undefined;
  const tagsMenuOps = config.tags ? createMenuOperations() : undefined;
  const emojisMenuOps = config.emojis ? createMenuOperations() : undefined;
  // Snippets (`;` menu) follow mentions: any markdown area that can @-mention
  // can also insert snippets, unless explicitly opted out. Editors with a
  // custom mention entity source (sandbox/onboarding) are excluded — the
  // snippets menu reads from quickAccess, which those editors bypass.
  const snippetsMenuOps =
    config.mentions && !config.mentions.entities && config.snippets !== false
      ? createMenuOperations()
      : undefined;
  // Skills (`/` menu) are opt-in for AI markdown areas. They share the `/`
  // trigger with the actions slash menu, so they only activate when actions
  // are disabled, and they read from quickAccess like snippets, so editors
  // with a custom mention entity source are excluded.
  const skillsMenuOps =
    config.skills &&
    !actionsMenuOps &&
    config.mentions &&
    !config.mentions.entities &&
    config.type !== 'plain-text'
      ? createMenuOperations()
      : undefined;
  // Agent commands (`/` menu) list the slash commands a connected coding
  // agent advertises over ACP. They share the `/` trigger with the actions
  // and skills menus, so they only activate when neither owns it.
  const agentCommandsMenuOps =
    config.agentCommands &&
    !actionsMenuOps &&
    !skillsMenuOps &&
    config.type !== 'plain-text'
      ? createMenuOperations()
      : undefined;
  return {
    actionsMenuOps,
    mentionsMenuOps,
    tagsMenuOps,
    emojisMenuOps,
    snippetsMenuOps,
    skillsMenuOps,
    agentCommandsMenuOps,
  };
}

function applyTextModePlugins(
  config: EditorConfig,
  plugins: LexicalPlugins,
  setMarkdownState: (value: string) => void
): void {
  if (config.type === 'plain-text') {
    plugins.plainText().state<string>(setMarkdownState, 'plain');
  } else if (config.singleLine) {
    plugins.richText().state<string>(setMarkdownState, 'markdown');
  } else {
    // Full markdown: everything
    plugins
      .richText()
      .list()
      .markdownShortcuts()
      .delete()
      .state<string>(setMarkdownState, 'markdown');
  }
}

function applyHistoryAndLinePlugins(
  config: EditorConfig,
  plugins: LexicalPlugins
): void {
  if (config.history) {
    plugins.history(config.history.timeGap);
  }
  if (config.singleLine) {
    plugins.use(singleLinePlugin());
  }
  if (config.restoreFocus) {
    plugins.use(restoreFocusPlugin());
  }
}

function applyClipboardAndStructurePlugins(
  config: EditorConfig,
  plugins: LexicalPlugins,
  lexicalWrapper: ReturnType<typeof createLexicalWrapper>
): void {
  plugins.use(textPastePlugin());
  if (config.type !== 'plain-text') {
    plugins.use(markdownPastePlugin());
  }
  if (!config.handlers.onTab) {
    plugins.use(tabIndentationPlugin());
  }
  if (config.type !== 'plain-text' && !config.singleLine) {
    plugins.use(horizontalRulePlugin());
    plugins.use(normalizeEnterPlugin());
  }
  if (config.type !== 'plain-text') {
    plugins.use(awaitPlugin());
  }
  if (config.selectionData) {
    plugins.use(selectionDataPlugin(lexicalWrapper));
  }
}

function applyInlineMenuPlugins(
  config: EditorConfig,
  plugins: LexicalPlugins,
  menuOps: InlineMenuOps
): void {
  if (menuOps.actionsMenuOps) {
    plugins.use(actionsPlugin({ menu: menuOps.actionsMenuOps }));
  }
  if (config.type === 'plain-text') return;
  if (config.mentions && menuOps.mentionsMenuOps) {
    plugins.use(
      mentionsPlugin({
        menu: menuOps.mentionsMenuOps,
        onCreateMention: config.mentions.onCreate,
        onRemoveMention: config.mentions.onRemove,
        sourceDocumentId: config.mentions.sourceDocumentId,
      })
    );
  }
  if (config.tags && menuOps.tagsMenuOps) {
    plugins.use(
      tagsPlugin({
        menu: menuOps.tagsMenuOps,
        insertTags: config.tags.insertTags,
        onCreateTag: config.tags.applyTargetLabel
          ? undefined
          : config.tags.onCreate,
        onRemoveTag: config.tags.onRemove,
        setTags: config.tags.setTags,
      })
    );
  }
  if (menuOps.emojisMenuOps) {
    plugins.use(emojisPlugin({ menu: menuOps.emojisMenuOps }));
  }
  if (menuOps.snippetsMenuOps) {
    plugins.use(
      snippetsPlugin({
        menu: menuOps.snippetsMenuOps,
        sourceDocumentId: config.mentions?.sourceDocumentId,
      })
    );
  }
  if (menuOps.skillsMenuOps) {
    plugins.use(skillsPlugin({ menu: menuOps.skillsMenuOps }));
  }
  if (menuOps.agentCommandsMenuOps && config.agentCommands) {
    plugins.use(
      agentCommandsPlugin({
        menu: menuOps.agentCommandsMenuOps,
        commands: config.agentCommands.commands,
      })
    );
  }
}

function applyMediaAndLayoutPlugins(
  config: EditorConfig,
  plugins: LexicalPlugins,
  editor: ReturnType<typeof createLexicalWrapper>['editor']
): {
  dragInsertStore: ReturnType<typeof createDragInsertStore>[0] | undefined;
  draggableBlockStore:
    | ReturnType<typeof createDraggableBlockStore>[0]
    | undefined;
  fileDropConfig: MediaDropOptions | undefined;
} {
  const mediaEnabled = !!config.media;
  const mediaConfig: MediaOptions | undefined =
    typeof config.media === 'object' ? config.media : undefined;
  const fileDropConfig: MediaDropOptions | undefined =
    mediaConfig?.fileDrop === true ? {} : mediaConfig?.fileDrop || undefined;

  const dragInsertStoreResult = fileDropConfig
    ? createDragInsertStore()
    : undefined;
  const dragInsertStore = dragInsertStoreResult?.[0];
  const setDragInsertStore = dragInsertStoreResult?.[1];

  if (mediaEnabled) {
    plugins.use(mediaPlugin());
  }
  if (fileDropConfig && setDragInsertStore) {
    plugins.use(dragInsertPlugin({ setState: setDragInsertStore }));
  }

  const draggableBlockStoreResult = config.draggableBlocks
    ? createDraggableBlockStore()
    : undefined;
  const draggableBlockStore = draggableBlockStoreResult?.[0];
  const setDraggableBlockStore = draggableBlockStoreResult?.[1];

  if (config.draggableBlocks && setDraggableBlockStore) {
    plugins.use(draggableBlockPlugin({ setState: setDraggableBlockStore }));
  }

  // File clipboard paste — auto-register when fileDrop is enabled, since
  // dragInsertPlugin blocks DRAG_DROP_PASTE (Lexical's built-in paste-files
  // path) without processing the files. A custom filePaste config from
  // withFilePaste() takes precedence.
  if (fileDropConfig && !config.filePaste) {
    plugins.use(
      filePastePlugin({
        onPasteFilesAndDirs: (fileEntries, directories) => {
          handleFileFolderDrop(
            fileEntries,
            directories,
            createFilesReadyHandler(
              editor,
              undefined,
              undefined,
              undefined,
              undefined,
              fileDropConfig.constrainedMediaDimensions
            )
          );
        },
      })
    );
  }

  return { dragInsertStore, draggableBlockStore, fileDropConfig };
}

function applyRemainingPlugins(
  config: EditorConfig,
  plugins: LexicalPlugins,
  menuOps: InlineMenuOps,
  accessoryStore: ReturnType<typeof createAccessoryStore>[0] | undefined,
  setAccessoryStore: ReturnType<typeof createAccessoryStore>[1] | undefined
): void {
  if (config.code && accessoryStore && setAccessoryStore) {
    plugins.use(
      codePlugin({
        accessories: accessoryStore,
        setAccessories: setAccessoryStore,
      })
    );
  }
  if (config.checkboxToTask) {
    plugins.use(checkboxToTaskPlugin());
  }
  if (config.filePaste) {
    plugins.use(
      filePastePlugin({
        onPasteFilesAndDirs: config.filePaste.onPasteFilesAndDirs,
      })
    );
  }
  if (config.focusLeave) {
    plugins.use(
      keyboardFocusPlugin({
        onFocusLeaveStart: config.focusLeave.onStart,
        onFocusLeaveEnd: config.focusLeave.onEnd,
        ignoreKeys: () => isAnyInlineMenuOpen(menuOps),
      })
    );
  }
}

function createEditorControls(
  editor: ReturnType<typeof createLexicalWrapper>['editor'],
  markdownState: () => string,
  menuOps: InlineMenuOps
): EditorControls {
  return {
    focus: () => editor.focus(),
    blur: () => {
      editor.getRootElement()?.blur();
    },
    clear: () => {
      initializeEditorEmpty(editor);
    },
    getMarkdown: () => markdownState(),
    setMarkdown: (md: string) => setEditorStateFromMarkdown(editor, md),
    getState: () => getSaveState(editor.getEditorState()),
    setState: (state: SerializedEditorState) =>
      initializeEditorWithState(editor, state),
    getLexical: () => editor,
    isInlineMenuOpen: () => isAnyInlineMenuOpen(menuOps),
  };
}

export function buildHandleFromConfig(config: EditorConfig): EditorHandle {
  const [isInteractable, setIsInteractable] = createSignal(true);

  const lexicalWrapper = createLexicalWrapperForConfig(config, isInteractable);

  if (config.skipPreviewFetch) {
    lexicalWrapper.skipPreviewFetch = true;
  }

  const { editor, plugins, cleanup: cleanupLexical } = lexicalWrapper;

  const [markdownState, setMarkdownState] = createSignal<string>('');
  const menuOps = createInlineMenuOps(config);

  const accessoryStoreResult = config.code ? createAccessoryStore() : undefined;
  const accessoryStore = accessoryStoreResult?.[0];
  const setAccessoryStore = accessoryStoreResult?.[1];

  applyTextModePlugins(config, plugins, setMarkdownState);
  applyHistoryAndLinePlugins(config, plugins);
  applyClipboardAndStructurePlugins(config, plugins, lexicalWrapper);
  applyInlineMenuPlugins(config, plugins, menuOps);
  const { dragInsertStore, draggableBlockStore, fileDropConfig } =
    applyMediaAndLayoutPlugins(config, plugins, editor);
  applyRemainingPlugins(
    config,
    plugins,
    menuOps,
    accessoryStore,
    setAccessoryStore
  );

  const controls = createEditorControls(editor, markdownState, menuOps);

  return {
    controls,
    lexical: editor,
    plugins,
    selection: lexicalWrapper.selection,
    _internal: {
      builderConfig: config,
      lexicalWrapper,
      editor,
      cleanupLexical,
      isInteractable,
      setIsInteractable,
      markdownState,
      actionsMenuOps: menuOps.actionsMenuOps,
      mentionsMenuOps: menuOps.mentionsMenuOps,
      tagsMenuOps: menuOps.tagsMenuOps,
      emojisMenuOps: menuOps.emojisMenuOps,
      snippetsMenuOps: menuOps.snippetsMenuOps,
      skillsMenuOps: menuOps.skillsMenuOps,
      agentCommandsMenuOps: menuOps.agentCommandsMenuOps,
      accessoryStore,
      dragInsertStore,
      draggableBlockStore,
      fileDropConfig,
    },
  };
}
