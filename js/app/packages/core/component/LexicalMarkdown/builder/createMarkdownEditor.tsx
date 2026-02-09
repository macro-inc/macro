/**
 * @file Builder pattern for creating markdown editors with configurable features.
 *
 * Usage:
 *   const { Editor, controls } = createMarkdownEditor()
 *     .withMentions()
 *     .withHistory()
 *     .onEnter(handleSend)
 *     .build();
 */

import type { EditorType } from '@lexical-core';
import { onElementConnect } from '@solid-primitives/lifecycle';
import {
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  type LexicalEditor,
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
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '../context/LexicalWrapperContext';
import {
  emojisPlugin,
  type ItemMention,
  mentionsPlugin,
  singleLinePlugin,
  tabIndentationPlugin,
  textPastePlugin,
} from '../plugins';
import { createMenuOperations } from '../shared/inlineMenu';
import {
  editorIsEmpty,
  initializeEditorEmpty,
  setEditorStateFromMarkdown,
} from '../utils';
import { DecoratorRenderer } from '../component/core/DecoratorRenderer';
import { EmojiMenu } from '../component/menu/EmojiMenu';
import { FloatingLinkMenu } from '../component/menu/FloatingLinkMenu';
import { MentionsMenu } from '../component/menu/MentionsMenu';

// ─────────────────────────────────────────────────────────────
// Type Definitions
// ─────────────────────────────────────────────────────────────

export interface MentionsConfig {
  /** Which mention sources to enable */
  sources?: Array<'users' | 'documents' | 'emojis'>;
  /** Called when a mention is removed */
  onRemove?: (mention: ItemMention) => void;
}

export interface LinksConfig {
  /** Show floating link menu */
  floatingMenu?: boolean;
}

export interface HistoryConfig {
  /** Debounce time in ms for grouping changes */
  timeGap?: number;
}

export interface EditorHandlers {
  onEnter?: (event: KeyboardEvent, markdown: string) => boolean;
  onEscape?: (event: KeyboardEvent) => boolean;
  onTab?: (event: KeyboardEvent) => boolean;
  onChange?: (markdown: string) => void;
}

export interface EditorControls {
  focus: () => void;
  blur: () => void;
  clear: () => void;
  getMarkdown: () => string;
  setMarkdown: (markdown: string) => void;
  getEditor: () => LexicalEditor;
}

export interface EditorComponentProps {
  placeholder?: string;
  initialValue?: string;
  disabled?: boolean;
  autofocus?: boolean;
  class?: string;
}

export interface BuiltEditor {
  /** The editor component to render */
  Editor: Component<EditorComponentProps>;
  /** Imperative controls */
  controls: EditorControls;
  /** Plugin manager for registering additional plugins */
  plugins: ReturnType<typeof createLexicalWrapper>['plugins'];
}

// ─────────────────────────────────────────────────────────────
// Builder State
// ─────────────────────────────────────────────────────────────

interface BuilderState {
  type: EditorType;
  namespace: string;
  mentions?: MentionsConfig;
  links?: LinksConfig;
  history?: HistoryConfig;
  singleLine: boolean;
  handlers: EditorHandlers;
}

// ─────────────────────────────────────────────────────────────
// Build Function
// ─────────────────────────────────────────────────────────────

function buildEditor(state: BuilderState): BuiltEditor {
  // Create the lexical wrapper
  const lexicalWrapper = createLexicalWrapper({
    type: state.type,
    namespace: state.namespace,
    isInteractable: () => true,
  });

  const { editor, plugins, cleanup: cleanupLexical } = lexicalWrapper;

  // State for markdown content
  const [markdownState, setMarkdownState] = createSignal<string>('');

  // Menu operations for mentions and emojis
  const mentionsMenuOps = state.mentions ? createMenuOperations() : undefined;
  const emojisMenuOps = state.mentions?.sources?.includes('emojis')
    ? createMenuOperations()
    : undefined;

  // ─────────────────────────────────────────────────────────
  // Register core plugins
  // ─────────────────────────────────────────────────────────

  if (state.type === 'plain-text') {
    // Plain text: no rich formatting
    plugins.plainText().state<string>(setMarkdownState, 'plain');
  } else if (state.singleLine) {
    // Single line: rich text but no lists/shortcuts (they don't make sense)
    plugins.richText().delete().state<string>(setMarkdownState, 'markdown');
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
  if (state.history) {
    plugins.history(state.history.timeGap);
  }

  // Single line mode
  if (state.singleLine) {
    plugins.use(singleLinePlugin());
  }

  // Text paste handling
  plugins.use(textPastePlugin());

  // Tab indentation (unless custom handler)
  if (!state.handlers.onTab) {
    plugins.use(tabIndentationPlugin());
  }

  // ─────────────────────────────────────────────────────────
  // Register feature plugins
  // ─────────────────────────────────────────────────────────

  // Mentions & Emojis (not available for plain-text - nodes not registered)
  if (state.type !== 'plain-text') {
    if (state.mentions && mentionsMenuOps) {
      plugins.use(
        mentionsPlugin({
          menu: mentionsMenuOps,
          onRemoveMention: state.mentions.onRemove,
        })
      );
    }

    if (emojisMenuOps) {
      plugins.use(emojisPlugin({ menu: emojisMenuOps }));
    }
  }

  // ─────────────────────────────────────────────────────────
  // Create the Editor component
  // ─────────────────────────────────────────────────────────

  const Editor: Component<EditorComponentProps> = (props) => {
    const [showPlaceholder, setShowPlaceholder] = createSignal(true);

    // Track initialization
    let didInitializeContent = false;

    const onConnect = () => {
      if (props.autofocus) {
        setTimeout(() => {
          editor.focus();
        });
      }

      if (props.initialValue) {
        setEditorStateFromMarkdown(editor, props.initialValue);
      } else {
        initializeEditorEmpty(editor);
      }

      didInitializeContent = true;
    };

    // Track editable state
    createEffect(() => {
      editor.setEditable(!props.disabled);
    });

    // onChange callback
    createEffect(
      on(
        markdownState,
        () => {
          if (!didInitializeContent) return;
          state.handlers.onChange?.(markdownState());
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
    let cleanupEnter: () => void = () => {};
    let cleanupEscape: () => void = () => {};
    let cleanupTab: () => void = () => {};

    createEffect(() => {
      cleanupEnter();
      const onEnter = state.handlers.onEnter;
      if (!onEnter) return;

      cleanupEnter = editor.registerCommand(
        KEY_ENTER_COMMAND,
        (e) => {
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
        },
        COMMAND_PRIORITY_HIGH
      );
    });

    createEffect(() => {
      cleanupEscape();
      const onEscape = state.handlers.onEscape;
      if (!onEscape) return;

      cleanupEscape = editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        (e) => onEscape(e),
        COMMAND_PRIORITY_CRITICAL
      );
    });

    createEffect(() => {
      cleanupTab();
      const onTab = state.handlers.onTab;
      if (!onTab) return;

      cleanupTab = editor.registerCommand(
        KEY_TAB_COMMAND,
        (e) => onTab(e),
        COMMAND_PRIORITY_CRITICAL
      );
    });

    // Cleanup on unmount
    onCleanup(() => {
      cleanupEnter();
      cleanupEscape();
      cleanupTab();
      cleanupLexical();
    });

    return (
      <LexicalWrapperContext.Provider value={lexicalWrapper}>
        <div
          class={`${props.class ?? ''} relative w-full h-full overflow-auto min-h-8`}
          on:keydown={(e) => e.stopPropagation()}
          on:click={(e) => {
            e.stopPropagation();
            editor.focus();
          }}
          on:mousedown={(e) => e.stopPropagation()}
          on:mouseup={(e) => e.stopPropagation()}
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

          {/* Placeholder */}
          <Show when={showPlaceholder()}>
            <div class="pointer-events-none text-ink-placeholder/50 absolute top-0">
              <p class="my-1.5 pointer-events-none">
                {props.placeholder ?? '...'}
              </p>
            </div>
          </Show>

          {/* Mentions Menu */}
          {mentionsMenuOps && (
            <MentionsMenu
              editor={editor}
              menu={mentionsMenuOps}
              useBlockBoundary={false}
              emails={() => []}
            />
          )}

          {/* Emoji Menu */}
          {emojisMenuOps && (
            <EmojiMenu
              editor={editor}
              menu={emojisMenuOps}
              useBlockBoundary={false}
            />
          )}

          {/* Floating Link Menu */}
          {state.links?.floatingMenu && (
            <FloatingMenuGroup>
              <FloatingLinkMenu />
            </FloatingMenuGroup>
          )}
        </div>
      </LexicalWrapperContext.Provider>
    );
  };

  // ─────────────────────────────────────────────────────────
  // Create controls
  // ─────────────────────────────────────────────────────────

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
    getEditor: () => editor,
  };

  return { Editor, controls, plugins };
}

// ─────────────────────────────────────────────────────────────
// Builder Class
// ─────────────────────────────────────────────────────────────

class MarkdownEditorBuilder {
  private state: BuilderState;

  constructor(type: EditorType = 'markdown') {
    this.state = {
      type,
      namespace: 'builder-editor',
      singleLine: false,
      handlers: {},
    };
  }

  namespace(name: string): this {
    this.state.namespace = name;
    return this;
  }

  withMentions(config: MentionsConfig = {}): this {
    this.state.mentions = {
      sources: ['users', 'documents', 'emojis'],
      ...config,
    };
    return this;
  }

  withLinks(config: LinksConfig = {}): this {
    this.state.links = {
      floatingMenu: true,
      ...config,
    };
    return this;
  }

  withHistory(config: HistoryConfig = {}): this {
    this.state.history = {
      timeGap: 400,
      ...config,
    };
    return this;
  }

  singleLine(): this {
    this.state.singleLine = true;
    return this;
  }

  onEnter(handler: EditorHandlers['onEnter']): this {
    this.state.handlers.onEnter = handler;
    return this;
  }

  onEscape(handler: EditorHandlers['onEscape']): this {
    this.state.handlers.onEscape = handler;
    return this;
  }

  onTab(handler: EditorHandlers['onTab']): this {
    this.state.handlers.onTab = handler;
    return this;
  }

  onChange(handler: EditorHandlers['onChange']): this {
    this.state.handlers.onChange = handler;
    return this;
  }

  build(): BuiltEditor {
    return buildEditor(this.state);
  }
}

// ─────────────────────────────────────────────────────────────
// Factory Function (Entry Point)
// ─────────────────────────────────────────────────────────────

export function createMarkdownEditor(
  type: EditorType = 'markdown'
): MarkdownEditorBuilder {
  return new MarkdownEditorBuilder(type);
}
