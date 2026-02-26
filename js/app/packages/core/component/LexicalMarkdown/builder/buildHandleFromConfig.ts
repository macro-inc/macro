import type { EditorType } from '@lexical-core';
import { createLexicalWrapper } from '../context/LexicalWrapperContext';
import {
  codePlugin,
  createAccessoryStore,
  createDragInsertStore,
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
  tabIndentationPlugin,
  actionsPlugin,
  textPastePlugin,
} from '../plugins';
import { createFilesReadyHandler } from '../utils/fileUploadUtils';
import { handleFileFolderDrop } from '@core/util/upload';
import { checkboxToTaskPlugin } from '../plugins/checkbox-to-task';
import { normalizeEnterPlugin } from '../plugins/normalize-enter';
import { restoreFocusPlugin } from '../plugins/restore-focus';
import { createMenuOperations } from '../shared/inlineMenu';
import type { SerializedEditorState } from 'lexical';
import {
  getSaveState,
  initializeEditorEmpty,
  initializeEditorWithState,
  setEditorStateFromMarkdown,
} from '../utils';
import { createSignal } from 'solid-js';
import type {
  EditorConfig,
  EditorControls,
  EditorHandle,
  MediaDropOptions,
  MediaOptions,
} from './types';

export function buildHandleFromConfig(config: EditorConfig): EditorHandle {
  const [isInteractable, setIsInteractable] = createSignal(true);

  const lexicalWrapper = config.withIds
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

  const { editor, plugins, cleanup: cleanupLexical } = lexicalWrapper;

  const [markdownState, setMarkdownState] = createSignal<string>('');

  const actionsMenuOps =
    config.actions !== false && config.type !== 'plain-text'
      ? createMenuOperations()
      : undefined;
  const mentionsMenuOps = config.mentions ? createMenuOperations() : undefined;
  const emojisMenuOps = config.emojis ? createMenuOperations() : undefined;

  const accessoryStoreResult = config.code ? createAccessoryStore() : undefined;
  const accessoryStore = accessoryStoreResult?.[0];
  const setAccessoryStore = accessoryStoreResult?.[1];

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

  // History
  if (config.history) {
    plugins.history(config.history.timeGap);
  }

  // Single line mode
  if (config.singleLine) {
    plugins.use(singleLinePlugin());
  }

  // Restore focus (registered early, before other plugins)
  if (config.restoreFocus) {
    plugins.use(restoreFocusPlugin());
  }

  // Text paste handling
  plugins.use(textPastePlugin());

  // Markdown paste handling (rich & full editors only)
  if (config.type !== 'plain-text') {
    plugins.use(markdownPastePlugin());
  }

  // Tab indentation (unless custom handler)
  if (!config.handlers.onTab) {
    plugins.use(tabIndentationPlugin());
  }

  // Horizontal rules & normalize-enter (full multi-line markdown only)
  if (config.type !== 'plain-text' && !config.singleLine) {
    plugins.use(horizontalRulePlugin());
    plugins.use(normalizeEnterPlugin());
  }

  // Selection / formatting state
  if (config.selectionData) {
    plugins.use(selectionDataPlugin(lexicalWrapper));
  }

  // Actions / slash-command menu (not available for plain-text)
  if (actionsMenuOps) {
    plugins.use(actionsPlugin({ menu: actionsMenuOps }));
  }

  // Mentions & Emojis (not available for plain-text — nodes not registered)
  if (config.type !== 'plain-text') {
    if (config.mentions && mentionsMenuOps) {
      plugins.use(
        mentionsPlugin({
          menu: mentionsMenuOps,
          onCreateMention: config.mentions.onCreate,
          onRemoveMention: config.mentions.onRemove,
        })
      );
    }

    if (emojisMenuOps) {
      plugins.use(emojisPlugin({ menu: emojisMenuOps }));
    }
  }

  // Media (images, videos)
  const mediaEnabled = !!config.media;
  const mediaConfig: MediaOptions | undefined =
    typeof config.media === 'object' ? config.media : undefined;
  const fileDropConfig: MediaDropOptions | undefined =
    mediaConfig?.fileDrop === true ? {} : mediaConfig?.fileDrop || undefined;

  // Drag-insert store (shared between plugin and indicator)
  const dragInsertStoreResult = fileDropConfig
    ? createDragInsertStore()
    : undefined;
  const dragInsertStore = dragInsertStoreResult?.[0];
  const setDragInsertStore = dragInsertStoreResult?.[1];

  if (mediaEnabled) {
    plugins.use(mediaPlugin());
  }

  // File drag-and-drop from desktop
  if (fileDropConfig && setDragInsertStore) {
    plugins.use(dragInsertPlugin({ setState: setDragInsertStore }));
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

  // Code blocks with syntax highlighting
  if (config.code && accessoryStore && setAccessoryStore) {
    plugins.use(
      codePlugin({
        accessories: accessoryStore,
        setAccessories: setAccessoryStore,
      })
    );
  }

  // Checkbox to task conversion
  if (config.checkboxToTask) {
    plugins.use(checkboxToTaskPlugin());
  }

  // File paste handling
  if (config.filePaste) {
    plugins.use(
      filePastePlugin({
        onPasteFilesAndDirs: config.filePaste.onPasteFilesAndDirs,
      })
    );
  }

  // Keyboard focus leave detection
  if (config.focusLeave) {
    plugins.use(
      keyboardFocusPlugin({
        onFocusLeaveStart: config.focusLeave.onStart,
        onFocusLeaveEnd: config.focusLeave.onEnd,
        ignoreKeys: () =>
          (actionsMenuOps?.isOpen() ?? false) ||
          (mentionsMenuOps?.isOpen() ?? false) ||
          (emojisMenuOps?.isOpen() ?? false),
      })
    );
  }

  const controls: EditorControls = {
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
  };

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
      actionsMenuOps,
      mentionsMenuOps,
      emojisMenuOps,
      accessoryStore,
      dragInsertStore,
      fileDropConfig,
    },
  };
}
