import { cn } from '@ui/utils/classname';
import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import { handleFileFolderDrop } from '@core/util/upload';
import { onElementConnect } from '@solid-primitives/lifecycle';
import {
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
} from 'lexical';
import {
  type Component,
  createEffect,
  createSignal,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import { FloatingMenuGroup } from '../context/FloatingMenuContext';
import { LexicalWrapperContext } from '../context/LexicalWrapperContext';
import { registerCommandEffect } from '../plugins';
import {
  createFilesReadyHandler,
  getDragDropPosition,
} from '../utils/fileUploadUtils';
import {
  editorIsEmpty,
  initializeEditorEmpty,
  initializeEditorWithState,
  setEditorStateFromMarkdown,
} from '../utils';
import { DecoratorRenderer } from '../component/core/DecoratorRenderer';
import { DragInsertIndicator } from '../component/misc/DragInsertIndicator';
import { NodeAccessoryRenderer } from '../component/core/NodeAccessoryRenderer';
import { EmojiMenu } from '../component/menu/EmojiMenu';
import { FloatingLinkMenu } from '../component/menu/FloatingLinkMenu';
import { MentionsMenu } from '../component/menu/MentionsMenu';
import { ActionMenu } from '../component/menu/ActionsMenu';
import type { EditorBuilder, EditorComponentProps } from './types';

export const MarkdownShell: Component<
  { config: EditorBuilder } & EditorComponentProps
> = (props) => {
  const handle = props.config.buildHandle();
  const state = handle._internal;
  const {
    editor,
    lexicalWrapper,
    cleanupLexical,
    builderConfig,
    markdownState,
  } = state;

  const [showPlaceholder, setShowPlaceholder] = createSignal(true);

  // Track initialization so onChange is not fired during setup
  let didInitializeContent = false;

  const onConnect = () => {
    if (props.autofocus) {
      setTimeout(() => editor.focus());
    }

    if (props.initialState) {
      initializeEditorWithState(editor, props.initialState);
    } else if (props.initialValue) {
      setEditorStateFromMarkdown(editor, props.initialValue);
    } else {
      initializeEditorEmpty(editor);
    }

    didInitializeContent = true;
  };

  // Track editable state
  createEffect(() => {
    const enabled = !props.disabled;
    editor.setEditable(enabled);
    state.setIsInteractable(enabled);
  });

  // onChange callback
  createEffect(
    on(
      markdownState,
      () => {
        if (!didInitializeContent) return;
        builderConfig.handlers.onChange?.(markdownState());
      },
      { defer: true }
    )
  );

  // Placeholder visibility
  createEffect(() => {
    markdownState();
    setShowPlaceholder(editorIsEmpty(editor));
  });

  // Register key handlers
  registerCommandEffect(
    editor,
    KEY_ENTER_COMMAND,
    () => {
      const onEnter = builderConfig.handlers.onEnter;
      if (!onEnter) return undefined;
      return (e) => {
        if (!e) return false;
        if (e.shiftKey) {
          // Shift+enter = regular newline
          Object.defineProperty(e, 'shiftKey', { value: false });
          return false;
        }
        const captured = onEnter(e, markdownState());
        if (captured) {
          e.preventDefault();
          e.stopPropagation();
        }
        return captured;
      };
    },
    COMMAND_PRIORITY_HIGH
  );

  registerCommandEffect(
    editor,
    KEY_ESCAPE_COMMAND,
    () => {
      const onEscape = builderConfig.handlers.onEscape;
      return onEscape ? (e) => onEscape(e) : undefined;
    },
    COMMAND_PRIORITY_CRITICAL
  );

  registerCommandEffect(
    editor,
    KEY_TAB_COMMAND,
    () => {
      const onTab = builderConfig.handlers.onTab;
      return onTab ? (e) => onTab(e) : undefined;
    },
    COMMAND_PRIORITY_CRITICAL
  );

  onCleanup(cleanupLexical);

  // File drop handler — wired to fileFolderDrop directive
  const onFileDrop = state.fileDropConfig
    ? (
        fileEntries: FileSystemFileEntry[],
        folderEntries: FileSystemDirectoryEntry[],
        e?: DragEvent
      ) => {
        if (!e) return;
        handleFileFolderDrop(
          fileEntries,
          folderEntries,
          createFilesReadyHandler(
            editor,
            undefined,
            undefined,
            () => getDragDropPosition(editor, e, true),
            undefined,
            state.fileDropConfig!.constrainedMediaDimensions
          )
        );
      }
    : undefined;

  // Keep TS happy — ensures the directive import is not tree-shaken
  void fileFolderDrop;

  return (
    <LexicalWrapperContext.Provider value={lexicalWrapper}>
      <div
        class={cn('relative h-full overflow-y-auto min-h-8', props.class)}
        on:keydown={(e) => e.stopPropagation()}
        on:click={(e) => {
          e.stopPropagation();
          editor.focus();
        }}
        on:mousedown={(e) => e.stopPropagation()}
        on:mouseup={(e) => e.stopPropagation()}
        use:fileFolderDrop={
          onFileDrop
            ? {
                onDrop: onFileDrop,
                disabled: props.disabled,
              }
            : undefined
        }
      >
        {/* Content Editable */}
        <div
          ref={(el) => {
            onElementConnect(el, () => {
              editor.setRootElement(el);
              onConnect();
            });
          }}
          contentEditable={!props.disabled}
        />

        <DecoratorRenderer editor={editor} />

        {/* Node Accessories (code blocks) */}
        <Show when={state.accessoryStore}>
          {(store) => <NodeAccessoryRenderer editor={editor} store={store()} />}
        </Show>

        <Show when={showPlaceholder()}>
          <div class="pointer-events-none text-ink-placeholder/50 absolute top-0">
            <p class="my-1.5 pointer-events-none">
              {props.placeholder ?? '...'}
            </p>
          </div>
        </Show>

        <Show when={state.dragInsertStore}>
          {(store) => (
            <DragInsertIndicator state={store()} active={!props.disabled} />
          )}
        </Show>

        <Show when={state.mentionsMenuOps}>
          {(menu) => (
            <MentionsMenu
              editor={editor}
              menu={menu()}
              useBlockBoundary={false}
              portalScope={props.portalScope}
              block={builderConfig.mentions?.block as any}
              showOpenTabs={builderConfig.mentions?.showOpenTabs}
              useSnapshotForDocuments={
                builderConfig.mentions?.useSnapshotForDocuments
              }
              entities={builderConfig.mentions?.entities}
              users={builderConfig.mentions?.users}
              disableMentionTracking={
                builderConfig.mentions?.disableMentionTracking
              }
            />
          )}
        </Show>

        <Show when={state.actionsMenuOps}>
          {(menu) => (
            <ActionMenu
              editor={editor}
              menu={menu()}
              useBlockBoundary={
                typeof builderConfig.actions === 'object'
                  ? (builderConfig.actions.useBlockBoundary ?? false)
                  : false
              }
              portalScope={props.portalScope}
            />
          )}
        </Show>

        {/* Emoji Menu */}
        <Show when={state.emojisMenuOps}>
          {(menu) => (
            <EmojiMenu
              editor={editor}
              menu={menu()}
              useBlockBoundary={false}
              portalScope={props.portalScope}
            />
          )}
        </Show>

        {/* Floating Link Menu */}
        <Show when={builderConfig.links?.floatingMenu}>
          <FloatingMenuGroup>
            <FloatingLinkMenu />
          </FloatingMenuGroup>
        </Show>
      </div>
    </LexicalWrapperContext.Provider>
  );
};
