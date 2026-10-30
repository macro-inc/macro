import { fireAndForget } from '@core/util/fireAndForget';
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
  listSwipeIndentPlugin,
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
  trailingParagraphPlugin,
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

  if (config.skipPreviewFetch) {
    lexicalWrapper.skipPreviewFetch = true;
  }

  const { editor, plugins, cleanup: cleanupLexical } = lexicalWrapper;

  const [markdownState, setMarkdownState] = createSignal<string>('');

  const actionsMenuOps = buildActionsMenuOps();
  const mentionsMenuOps = config.mentions ? createMenuOperations() : undefined;
  const tagsMenuOps = buildTagsMenuOps();
  const emojisMenuOps = config.emojis ? createMenuOperations() : undefined;
  // Snippets (`;` menu) follow mentions: any markdown area that can @-mention
  // can also insert snippets, unless explicitly opted out. Editors with a
  // custom mention entity source (sandbox/onboarding) are excluded — the
  // snippets menu reads from quickAccess, which those editors bypass.
  const snippetsMenuOps = buildSnippetsMenuOps();
  // Skills (`/` menu) are opt-in for AI markdown areas. They share the `/`
  // trigger with the actions slash menu, so they only activate when actions
  // are disabled, and they read from quickAccess like snippets, so editors
  // with a custom mention entity source are excluded.
  const skillsMenuOps = buildSkillsMenuOps();
  // Agent commands (`/` menu) list the slash commands a connected coding
  // agent advertises over ACP. They share the `/` trigger with the actions
  // and skills menus, so they only activate when neither owns it.
  const agentCommandsMenuOps = buildAgentCommandsMenuOps();

  const accessoryStoreResult = buildAccessoryStoreResult();
  const accessoryStore = buildAccessoryStore();
  const setAccessoryStore = buildSetAccessoryStore();

  updateBuildHandleFromConfig8();

  updateBuildHandleFromConfig3();

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
  plugins.use(textPastePlugin(config.resolveAppLink));

  // Markdown paste handling (rich & full editors only)
  if (config.type !== 'plain-text') {
    plugins.use(markdownPastePlugin());
  }

  // Tab indentation (unless custom handler)
  if (!config.handlers.onTab) {
    plugins.use(tabIndentationPlugin());
  }

  // Touch swipe indent/outdent for list items (Apple Notes-style).
  updateBuildHandleFromConfig5();

  // Horizontal rules & normalize-enter (full multi-line markdown only)
  updateBuildHandleFromConfig7();

  // Await placeholders for in-flight async operations (any non-plain-text editor).
  if (config.type !== 'plain-text') {
    plugins.use(awaitPlugin());
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
  updateBuildHandleFromConfig();

  // Media (images, videos)
  const mediaEnabled = !!config.media;
  const mediaConfig: MediaOptions | undefined =
    typeof config.media === 'object' ? config.media : undefined;
  const fileDropConfig: MediaDropOptions | undefined = buildFileDropConfig();

  // Drag-insert store (shared between plugin and indicator)
  const dragInsertStoreResult = fileDropConfig
    ? createDragInsertStore()
    : undefined;
  const dragInsertStore = buildDragInsertStore();
  const setDragInsertStore = buildSetDragInsertStore();

  if (mediaEnabled) {
    plugins.use(mediaPlugin());
  }

  // File drag-and-drop from desktop
  updateBuildHandleFromConfig4();

  // Drag-to-rearrange blocks (uses root element fallback since no anchor ref
  // is available during builder-time configuration).
  const draggableBlockStoreResult = config.draggableBlocks
    ? createDraggableBlockStore()
    : undefined;
  const draggableBlockStore = buildDraggableBlockStore();
  const setDraggableBlockStore = buildSetDraggableBlockStore();

  updateBuildHandleFromConfig6();

  // File clipboard paste — auto-register when fileDrop is enabled, since
  // dragInsertPlugin blocks DRAG_DROP_PASTE (Lexical's built-in paste-files
  // path) without processing the files. A custom filePaste config from
  // withFilePaste() takes precedence.
  updateBuildHandleFromConfig9();

  // Code blocks with syntax highlighting
  updateBuildHandleFromConfig2();

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
          isIgnoreKeysAllowed() || (agentCommandsMenuOps?.isOpen() ?? false),
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
    isInlineMenuOpen: () => {
      const mentions = mentionsMenuOps?.isOpen() ?? false;
      const tags = tagsMenuOps?.isOpen() ?? false;
      const emojis = emojisMenuOps?.isOpen() ?? false;
      const actions = actionsMenuOps?.isOpen() ?? false;
      const snippets = snippetsMenuOps?.isOpen() ?? false;
      const skills = skillsMenuOps?.isOpen() ?? false;
      const agentCommands = agentCommandsMenuOps?.isOpen() ?? false;
      return buildIsInlineMenuOpen();

      function buildIsInlineMenuOpen(): boolean {
        return (
          mentions ||
          tags ||
          emojis ||
          actions ||
          snippets ||
          skills ||
          agentCommands
        );
      }
    },
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
      tagsMenuOps,
      emojisMenuOps,
      snippetsMenuOps,
      skillsMenuOps,
      agentCommandsMenuOps,
      accessoryStore,
      dragInsertStore,
      draggableBlockStore,
      fileDropConfig,
    },
  };

  function buildAccessoryStoreResult() {
    return config.code ? createAccessoryStore() : undefined;
  }

  function buildTagsMenuOps() {
    return config.tags ? createMenuOperations() : undefined;
  }

  function buildSetDraggableBlockStore() {
    return draggableBlockStoreResult?.[1];
  }

  function buildDraggableBlockStore() {
    return draggableBlockStoreResult?.[0];
  }

  function buildSetDragInsertStore() {
    return dragInsertStoreResult?.[1];
  }

  function buildDragInsertStore() {
    return dragInsertStoreResult?.[0];
  }

  function buildSetAccessoryStore() {
    return accessoryStoreResult?.[1];
  }

  function buildAccessoryStore() {
    return accessoryStoreResult?.[0];
  }

  function updateBuildHandleFromConfig9() {
    if (fileDropConfig && !config.filePaste) {
      plugins.use(
        filePastePlugin({
          onPasteFilesAndDirs: (fileEntries, directories) => {
            fireAndForget(
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
              ),
              'markdown-file-paste'
            );
          },
        })
      );
    }
  }

  function updateBuildHandleFromConfig8() {
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

  function updateBuildHandleFromConfig7() {
    if (config.type !== 'plain-text' && !config.singleLine) {
      plugins.use(horizontalRulePlugin());
      plugins.use(normalizeEnterPlugin());
    }
  }

  function updateBuildHandleFromConfig6() {
    if (config.draggableBlocks && setDraggableBlockStore) {
      plugins.use(draggableBlockPlugin({ setState: setDraggableBlockStore }));
    }
  }

  function updateBuildHandleFromConfig5() {
    if (config.type !== 'plain-text' && !config.singleLine) {
      plugins.use(listSwipeIndentPlugin(isInteractable));
    }
  }

  function updateBuildHandleFromConfig4() {
    if (fileDropConfig && setDragInsertStore) {
      plugins.use(dragInsertPlugin({ setState: setDragInsertStore }));
    }
  }

  function updateBuildHandleFromConfig3() {
    if (config.type !== 'plain-text' && !config.singleLine) {
      plugins.use(trailingParagraphPlugin());
    }
  }

  function buildActionsMenuOps() {
    return config.actions !== false && config.type !== 'plain-text'
      ? createMenuOperations()
      : undefined;
  }

  function isIgnoreKeysAllowed(): boolean {
    return (
      (actionsMenuOps?.isOpen() ?? false) ||
      (mentionsMenuOps?.isOpen() ?? false) ||
      (tagsMenuOps?.isOpen() ?? false) ||
      (emojisMenuOps?.isOpen() ?? false) ||
      (snippetsMenuOps?.isOpen() ?? false) ||
      (skillsMenuOps?.isOpen() ?? false)
    );
  }

  function updateBuildHandleFromConfig2() {
    if (config.code && accessoryStore && setAccessoryStore) {
      plugins.use(
        codePlugin({
          accessories: accessoryStore,
          setAccessories: setAccessoryStore,
        })
      );
    }
  }

  function buildSnippetsMenuOps() {
    return config.mentions &&
      !config.mentions.entities &&
      config.snippets !== false
      ? createMenuOperations()
      : undefined;
  }

  function buildAgentCommandsMenuOps() {
    return config.agentCommands &&
      !actionsMenuOps &&
      !skillsMenuOps &&
      config.type !== 'plain-text'
      ? createMenuOperations()
      : undefined;
  }

  function buildFileDropConfig(): MediaDropOptions | undefined {
    return mediaConfig?.fileDrop === true
      ? {}
      : mediaConfig?.fileDrop || undefined;
  }

  function buildSkillsMenuOps() {
    return config.skills &&
      !actionsMenuOps &&
      config.mentions &&
      !config.mentions.entities &&
      config.type !== 'plain-text'
      ? createMenuOperations()
      : undefined;
  }

  function updateBuildHandleFromConfig() {
    if (config.type !== 'plain-text') {
      if (config.mentions && mentionsMenuOps) {
        plugins.use(
          mentionsPlugin({
            menu: mentionsMenuOps,
            onCreateMention: config.mentions.onCreate,
            onRemoveMention: config.mentions.onRemove,
            sourceDocumentId: config.mentions.sourceDocumentId,
          })
        );
      }

      if (config.tags && tagsMenuOps) {
        plugins.use(
          tagsPlugin({
            menu: tagsMenuOps,
            insertTags: config.tags.insertTags,
            onCreateTag: config.tags.applyTargetLabel
              ? undefined
              : config.tags.onCreate,
            onRemoveTag: config.tags.onRemove,
            setTags: config.tags.setTags,
          })
        );
      }

      if (emojisMenuOps) {
        plugins.use(emojisPlugin({ menu: emojisMenuOps }));
      }

      if (snippetsMenuOps) {
        plugins.use(
          snippetsPlugin({
            menu: snippetsMenuOps,
            sourceDocumentId: config.mentions?.sourceDocumentId,
          })
        );
      }

      if (skillsMenuOps) {
        plugins.use(skillsPlugin({ menu: skillsMenuOps }));
      }

      if (agentCommandsMenuOps && config.agentCommands) {
        plugins.use(
          agentCommandsPlugin({
            menu: agentCommandsMenuOps,
          })
        );
      }
    }
  }
}
