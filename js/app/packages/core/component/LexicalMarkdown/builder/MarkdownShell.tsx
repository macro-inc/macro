import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import { isMobile } from '@core/mobile/isMobile';
import { handleFileFolderDrop } from '@core/util/upload';
import { onElementConnect } from '@solid-primitives/lifecycle';
import { cn } from '@ui';
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
import { DecoratorRenderer } from '../component/core/DecoratorRenderer';
import { NodeAccessoryRenderer } from '../component/core/NodeAccessoryRenderer';
import { ActionMenu } from '../component/menu/ActionsMenu';
import { EmojiMenu } from '../component/menu/EmojiMenu';
import { FloatingLinkMenu } from '../component/menu/FloatingLinkMenu';
import { MentionsMenu } from '../component/menu/MentionsMenu';
import { SnippetsMenu } from '../component/menu/SnippetsMenu';
import { DragInsertIndicator } from '../component/misc/DragInsertIndicator';
import { FloatingMenuGroup } from '../context/FloatingMenuContext';
import { LexicalWrapperContext } from '../context/LexicalWrapperContext';
import { autoRegister, registerCommandEffect } from '../plugins';
import {
  editorIsEmpty,
  focusEditorWithoutScroll,
  initializeEditorEmpty,
  initializeEditorWithState,
  setEditorStateFromMarkdown,
} from '../utils';
import {
  createFilesReadyHandler,
  getDragDropPosition,
} from '../utils/fileUploadUtils';
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
      setTimeout(() => {
        focusEditorWithoutScroll(editor);
      });
    }

    const hasInitialContent =
      props.initialState !== undefined || props.initialValue !== undefined;

    if (props.initialState) {
      initializeEditorWithState(editor, props.initialState);
    } else if (props.initialValue) {
      setEditorStateFromMarkdown(editor, props.initialValue);
    } else {
      initializeEditorEmpty(editor);
    }

    didInitializeContent = true;

    // The deferred markdownState effect misses the synchronous change inside
    // init, so push the initial value out to onChange manually.
    if (hasInitialContent) {
      builderConfig.handlers.onChange?.(markdownState());
    }

    props.onConnect?.();
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
  autoRegister(
    editor.registerUpdateListener(({ editorState }) => {
      setShowPlaceholder(editorIsEmpty(editorState));
    })
  );

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
        class={cn(
          'relative h-full overflow-y-auto min-h-8 scrollbar-hidden',
          props.class
        )}
        on:keydown={(e) => e.stopPropagation()}
        on:click={(e) => {
          e.stopPropagation();
          if (!isMobile()) editor.focus();
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
            props.refFn?.(el);
          }}
          contentEditable={!props.disabled}
        />

        <DecoratorRenderer editor={editor} />

        {/* Node Accessories (code blocks) */}
        <Show when={state.accessoryStore}>
          {(store) => <NodeAccessoryRenderer editor={editor} store={store()} />}
        </Show>

        <Show when={showPlaceholder()}>
          <div class="pointer-events-none text-ink-placeholder absolute top-0">
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
              entities={builderConfig.mentions?.entities}
              users={builderConfig.mentions?.users}
              disableMentionTracking={
                builderConfig.mentions?.disableMentionTracking
              }
              sources={builderConfig.mentions?.sources}
            />
          )}
        </Show>

        <Show when={state.actionsMenuOps}>
          {(menu) => (
            <ActionMenu
              editor={editor}
              menu={menu()}
              useBlockBoundary={false}
              additionalActions={
                (builderConfig.actions &&
                  builderConfig.actions.additionalActions) ||
                undefined
              }
              ignoreActionIds={
                (builderConfig.actions &&
                  builderConfig.actions.ignoreActionIds) ||
                undefined
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

        {/* Snippets Menu */}
        <Show when={state.snippetsMenuOps}>
          {(menu) => (
            <SnippetsMenu
              editor={editor}
              menu={menu()}
              useBlockBoundary={false}
              portalScope={props.portalScope}
              sourceDocumentId={builderConfig.mentions?.sourceDocumentId}
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
