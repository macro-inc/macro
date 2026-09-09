import { handleFileFolderDrop } from '@core/util/upload';
import { HistoryExtension } from '@lexical/history';
import { CheckListExtension } from '@lexical/list';
import { CODE } from '@lexical/markdown';
import { PlainTextExtension } from '@lexical/plain-text';
import { RichTextExtension } from '@lexical/rich-text';
import { ALL_TRANSFORMERS, type EditorType } from '@macro-inc/lexical-core';
import { HR } from '@macro-inc/lexical-core/transformers/transformers';
import {
  type AnyLexicalExtensionArgument,
  configExtension,
  type SerializedEditorState,
} from 'lexical';
import { createSignal } from 'solid-js';
import {
  createLexicalWrapper,
  type LexicalWrapper,
} from '../context/LexicalWrapperContext';
import { pluginExtension } from '../extensions/pluginExtension';
import {
  actionsPlugin,
  agentCommandsPlugin,
  awaitPlugin,
  codePlugin,
  createAccessoryStore,
  createDraggableBlockStore,
  createDragInsertStore,
  customDeletePlugin,
  draggableBlockPlugin,
  dragInsertPlugin,
  emojisPlugin,
  filePastePlugin,
  horizontalRulePlugin,
  keyboardFocusPlugin,
  markdownPastePlugin,
  mediaPlugin,
  mentionsPlugin,
  type PluginFunction,
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
import { markdownShortcutsPlugin } from '../plugins/markdown-shortcuts';
import { normalizeEnterPlugin } from '../plugins/normalize-enter';
import { restoreFocusPlugin } from '../plugins/restore-focus';
import { createMenuOperations } from '../shared/inlineMenu';
import {
  bindStateAs,
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

export function buildHandleFromConfig(
  config: EditorConfig,
  additionalPlugins: PluginFunction[] = []
): EditorHandle {
  const [isInteractable, setIsInteractable] = createSignal(true);
  const [markdownState, setMarkdownState] = createSignal<string>('');

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

  const accessoryStoreResult = config.code ? createAccessoryStore() : undefined;
  const accessoryStore = accessoryStoreResult?.[0];
  const setAccessoryStore = accessoryStoreResult?.[1];

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

  // Drag-to-rearrange blocks (uses root element fallback since no anchor ref
  // is available during builder-time configuration).
  const draggableBlockStoreResult = config.draggableBlocks
    ? createDraggableBlockStore()
    : undefined;
  const draggableBlockStore = draggableBlockStoreResult?.[0];
  const setDraggableBlockStore = draggableBlockStoreResult?.[1];

  const extensions = (lexicalWrapper: LexicalWrapper) => {
    const result: AnyLexicalExtensionArgument[] = [];
    const use = (name: string, plugin: PluginFunction) => {
      result.push(pluginExtension(`builder/${name}`, plugin));
    };

    if (config.type === 'plain-text') {
      result.push(PlainTextExtension);
      use('state', (editor) => bindStateAs(editor, setMarkdownState, 'plain'));
    } else if (config.singleLine) {
      result.push(RichTextExtension);
      use('state', (editor) =>
        bindStateAs(editor, setMarkdownState, 'markdown')
      );
    } else {
      // Full markdown: everything
      result.push(RichTextExtension, CheckListExtension);
      use(
        'markdown-shortcuts',
        markdownShortcutsPlugin({
          transformers: ALL_TRANSFORMERS,
          triggerOnEnterTransformers: [HR, CODE],
        })
      );
      use('delete', customDeletePlugin());
      use('state', (editor) =>
        bindStateAs(editor, setMarkdownState, 'markdown')
      );
    }

    if (config.type !== 'plain-text' && !config.singleLine) {
      use('trailing-paragraph', trailingParagraphPlugin());
    }

    // History
    if (config.history) {
      result.push(
        configExtension(HistoryExtension, {
          delay: config.history.timeGap ?? 400,
        })
      );
    }

    // Single line mode
    if (config.singleLine) {
      use('single-line', singleLinePlugin());
    }

    // Restore focus (registered early, before other plugins)
    if (config.restoreFocus) {
      use('restore-focus', restoreFocusPlugin());
    }

    // Text paste handling
    use('text-paste', textPastePlugin());

    // Markdown paste handling (rich & full editors only)
    if (config.type !== 'plain-text') {
      use('markdown-paste', markdownPastePlugin());
    }

    // Tab indentation (unless custom handler)
    if (!config.handlers.onTab) {
      use('tab-indentation', tabIndentationPlugin());
    }

    // Horizontal rules & normalize-enter (full multi-line markdown only)
    if (config.type !== 'plain-text' && !config.singleLine) {
      use('horizontal-rule', horizontalRulePlugin());
      use('normalize-enter', normalizeEnterPlugin());
    }

    // Await placeholders for in-flight async operations (any non-plain-text editor).
    if (config.type !== 'plain-text') {
      use('await', awaitPlugin());
    }

    // Selection / formatting state
    if (config.selectionData) {
      use('selection-data', selectionDataPlugin(lexicalWrapper));
    }

    // Actions / slash-command menu (not available for plain-text)
    if (actionsMenuOps) {
      use('actions', actionsPlugin({ menu: actionsMenuOps }));
    }

    // Mentions & Emojis (not available for plain-text — nodes not registered)
    if (config.type !== 'plain-text') {
      if (config.mentions && mentionsMenuOps) {
        use(
          'mentions',
          mentionsPlugin({
            menu: mentionsMenuOps,
            onCreateMention: config.mentions.onCreate,
            onRemoveMention: config.mentions.onRemove,
            sourceDocumentId: config.mentions.sourceDocumentId,
          })
        );
      }

      if (config.tags && tagsMenuOps) {
        use(
          'tags',
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
        use('emojis', emojisPlugin({ menu: emojisMenuOps }));
      }

      if (snippetsMenuOps) {
        use(
          'snippets',
          snippetsPlugin({
            menu: snippetsMenuOps,
            sourceDocumentId: config.mentions?.sourceDocumentId,
          })
        );
      }

      if (skillsMenuOps) {
        use('skills', skillsPlugin({ menu: skillsMenuOps }));
      }

      if (agentCommandsMenuOps && config.agentCommands) {
        use(
          'agent-commands',
          agentCommandsPlugin({
            menu: agentCommandsMenuOps,
            commands: config.agentCommands.commands,
          })
        );
      }
    }

    if (mediaEnabled) {
      use('media', mediaPlugin());
    }

    // File drag-and-drop from desktop
    if (fileDropConfig && setDragInsertStore) {
      use('drag-insert', dragInsertPlugin({ setState: setDragInsertStore }));
    }

    if (config.draggableBlocks && setDraggableBlockStore) {
      use(
        'draggable-block',
        draggableBlockPlugin({ setState: setDraggableBlockStore })
      );
    }

    // File clipboard paste — auto-register when fileDrop is enabled, since
    // dragInsertPlugin blocks DRAG_DROP_PASTE (Lexical's built-in paste-files
    // path) without processing the files. A custom filePaste config from
    // withFilePaste() takes precedence.
    if (fileDropConfig && !config.filePaste) {
      use(
        'file-drop-paste',
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
      use(
        'code',
        codePlugin({
          accessories: accessoryStore,
          setAccessories: setAccessoryStore,
        })
      );
    }

    // Checkbox to task conversion
    if (config.checkboxToTask) {
      use('checkbox-to-task', checkboxToTaskPlugin());
    }

    // File paste handling
    if (config.filePaste) {
      use(
        'file-paste',
        filePastePlugin({
          onPasteFilesAndDirs: config.filePaste.onPasteFilesAndDirs,
        })
      );
    }

    // Keyboard focus leave detection
    if (config.focusLeave) {
      use(
        'keyboard-focus',
        keyboardFocusPlugin({
          onFocusLeaveStart: config.focusLeave.onStart,
          onFocusLeaveEnd: config.focusLeave.onEnd,
          ignoreKeys: () =>
            (actionsMenuOps?.isOpen() ?? false) ||
            (mentionsMenuOps?.isOpen() ?? false) ||
            (tagsMenuOps?.isOpen() ?? false) ||
            (emojisMenuOps?.isOpen() ?? false) ||
            (snippetsMenuOps?.isOpen() ?? false) ||
            (skillsMenuOps?.isOpen() ?? false) ||
            (agentCommandsMenuOps?.isOpen() ?? false),
        })
      );
    }

    for (const [index, plugin] of additionalPlugins.entries()) {
      use(`custom-${index}`, plugin);
    }

    return result;
  };

  const lexicalWrapper = config.withIds
    ? createLexicalWrapper({
        type: config.type as EditorType,
        namespace: config.namespace,
        isInteractable,
        withIds: true,
        skipPreviewFetch: config.skipPreviewFetch,
        extensions,
      })
    : createLexicalWrapper({
        type: config.type as EditorType,
        namespace: config.namespace,
        isInteractable,
        skipPreviewFetch: config.skipPreviewFetch,
        extensions,
      });

  const { editor, cleanup: cleanupLexical } = lexicalWrapper;

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
      return (
        mentions ||
        tags ||
        emojis ||
        actions ||
        snippets ||
        skills ||
        agentCommands
      );
    },
  };

  return {
    controls,
    lexical: editor,
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
}
