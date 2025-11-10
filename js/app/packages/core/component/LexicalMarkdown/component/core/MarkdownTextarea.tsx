import { recheckFocus } from '@app/signal/focus';
import type { PortalScope } from '@core/component/ScopedPortal';
import type { EditorType } from '@lexical-core';
import type { Item } from '@service-storage/generated/schemas/item';
import {
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  type LexicalEditor,
} from 'lexical';
import {
  type Accessor,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import type { SetStoreFunction } from 'solid-js/store';
import { FloatingMenuGroup } from '../../context/FloatingMenuContext';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '../../context/LexicalWrapperContext';
import {
  autoRegister,
  codePlugin,
  createAccessoryStore,
  customSelectionDataPlugin,
  emojisPlugin,
  type ItemMention,
  keyboardFocusPlugin,
  mentionsPlugin,
  registerRootEventListener,
  type SelectionData,
  selectionDataPlugin,
  tabIndentationPlugin,
} from '../../plugins';
import { createMenuOperations } from '../../shared/inlineMenu';
import {
  editorIsEmpty,
  initializeEditorEmpty,
  setEditorStateFromHtml,
  setEditorStateFromMarkdown,
} from '../../utils';
import { EmojiMenu } from '../menu/EmojiMenu';
import { FloatingLinkMenu } from '../menu/FloatingLinkMenu';
import { MentionsMenu, type UserMentionRecord } from '../menu/MentionsMenu';
import { DecoratorRenderer } from './DecoratorRenderer';
import { NodeAccessoryRenderer } from './NodeAccessoryRenderer';

/**
 * @param editable - A signal that indicates whether the textarea is editable
 * @param onChange - A callback function that is called when the textarea value changes.
 *     The current markdown text is passed as an argument.
 * @param initialValue - The initial markdown text to display in the textarea.
 * @param placeholder - The placeholder text to display in the textarea.
 * @param type - The type of editor to use. Defaults to 'markdown'. Could aslo pass chat to turn off headings.
 * @param onEnter - A callback function that is called when the user presses Enter in the textarea.
 *     If the function returns true, the enter press will not propagate to the lexical editor.
 * @param onEscape - A callback function that is called when the user presses Escape in the textarea. If the function
 *     returns true Lexical's default behavior will be prevented.
 */
export interface MarkdownTextareaProps {
  editable: Accessor<boolean>;
  onChange?: (value: string, editor?: LexicalEditor) => void;
  initialValue?: string;
  initialHtml?: string;
  placeholder?: string;
  type?: EditorType;
  onEnter?: (e: KeyboardEvent, value: string) => boolean;
  focusOnMount?: boolean;
  class?: string;
  anchor?: HTMLElement | null;
  onUserMention?: (mention: UserMentionRecord) => void;
  onRemoveMention?: (mention: ItemMention) => void;
  portalScope?: PortalScope;
  useBlockBoundary?: boolean;
  onDocumentMention?: (mention: Item) => void;
  onEscape?: (e: KeyboardEvent) => boolean;
  onTab?: (e: KeyboardEvent) => boolean;
  captureEditor?: (editor: LexicalEditor) => void;
  onFocusReady?: (focusFn: () => void) => void;
  onFocusLeaveStart?: (e: KeyboardEvent) => void;
  onFocusLeaveEnd?: (e: KeyboardEvent) => void;
  formatState?: SelectionData;
  setFormatState?: SetStoreFunction<SelectionData>;
}

export function MarkdownTextarea(props: MarkdownTextareaProps) {
  let mountRef!: HTMLDivElement;
  const lexicalWrapper = createLexicalWrapper({
    type: props.type ?? 'markdown',
    namespace: 'markdown-textarea',
    isInteractable: props.editable,
  });
  const { editor, plugins, cleanup: cleanupLexical } = lexicalWrapper;

  if (props.captureEditor) {
    props.captureEditor(editor);
  }

  if (props.onFocusReady) {
    props.onFocusReady(() => {
      if (editor.getRootElement()) editor.focus();
    });
  }

  const [markdownState, setMarkdownState] = createSignal<string>('');

  onMount(() => {
    if (props.focusOnMount) {
      setTimeout(() => {
        mountRef.focus();
      });
    }

    if (props.initialHtml) {
      setEditorStateFromHtml(editor, props.initialHtml);
    } else if (props.initialValue) {
      setEditorStateFromMarkdown(editor, props.initialValue);
    }
  });

  // better focus in handling. preserves selection on regain focus!
  autoRegister(
    registerRootEventListener(editor, 'focusin', (e) => {
      e.preventDefault();
      editor.focus();
      recheckFocus(); // force update global focus signal
    })
  );

  createEffect(() => {
    editor.setEditable(props.editable());
  });

  createEffect(() => {
    props.onChange?.(markdownState(), editor);
  });

  if (props.initialHtml) {
    setEditorStateFromHtml(editor, props.initialHtml);
  } else if (props.initialValue) {
    setEditorStateFromMarkdown(editor, props.initialValue);
  } else {
    initializeEditorEmpty(editor);
  }

  const [showPlaceholder, setShowPlaceholder] = createSignal(true);

  const mentionsMenuOperations = createMenuOperations();
  const emojisMenuOperations = createMenuOperations();

  plugins
    .richText()
    .list()
    .markdownShortcuts()
    .delete()
    .state<string>(setMarkdownState, 'markdown')
    .history(400)
    .use(
      props.formatState && props.setFormatState
        ? customSelectionDataPlugin(
            lexicalWrapper,
            props.formatState,
            props.setFormatState
          )
        : selectionDataPlugin(lexicalWrapper)
    )
    .use(tabIndentationPlugin())
    .use(
      mentionsPlugin({
        menu: mentionsMenuOperations,
        onRemoveMention: props.onRemoveMention,
      })
    )
    .use(emojisPlugin({ menu: emojisMenuOperations }));

  const [accessoryStore, setAccessoryStore] = createAccessoryStore();
  plugins.use(
    codePlugin({
      setAccessories: setAccessoryStore,
      accessories: accessoryStore,
    })
  );

  if (props.onFocusLeaveEnd && props.onFocusLeaveStart) {
    plugins.use(
      keyboardFocusPlugin({
        onFocusLeaveStart: props.onFocusLeaveStart,
        onFocusLeaveEnd: props.onFocusLeaveEnd,
        ignoreKeys: () =>
          mentionsMenuOperations.isOpen() || emojisMenuOperations.isOpen(),
      })
    );
  }

  let cleanupEnterListener: () => void = () => {};
  createEffect(() => {
    cleanupEnterListener();
    const onEnter = props.onEnter;
    if (onEnter == null) return;
    cleanupEnterListener = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (e: KeyboardEvent) => {
        // TODO (seamus) : This is hacky. If we got a props.onEnter,then shift+enter becomes
        // the new "regular enter", so we delete the shiftKey and pass along to lexical.
        if (e.altKey && e.shiftKey) {
          Object.defineProperty(e, 'altKey', { value: false });
          return false;
        }

        if (e.shiftKey) {
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
      // Run at HIGH here so that the mentions menu can run at CRITICAL
      COMMAND_PRIORITY_HIGH
    );
  });

  onMount(() => {
    editor.setRootElement(mountRef);
  });

  onCleanup(() => {
    cleanupEnterListener();
    cleanupLexical();
  });

  createEffect(() => {
    markdownState();
    setShowPlaceholder(editorIsEmpty(editor));
  });

  autoRegister(
    editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      (e) => (props.onEscape ? props.onEscape(e) : false),
      COMMAND_PRIORITY_CRITICAL
    ),
    editor.registerCommand(
      KEY_TAB_COMMAND,
      (e) => (props.onTab ? props.onTab(e) : false),
      COMMAND_PRIORITY_CRITICAL
    )
  );

  return (
    <LexicalWrapperContext.Provider value={lexicalWrapper}>
      <div
        class={`${props.class ?? ''} relative w-full h-full overflow-auto min-h-8`}
        on:keydown={(e) => {
          e.stopPropagation();
        }}
        on:click={(e) => {
          e.stopPropagation();
        }}
        on:mousedown={(e) => {
          e.stopPropagation();
        }}
        on:mouseup={(e) => {
          e.stopPropagation();
        }}
      >
        <div
          class="h-full"
          ref={mountRef}
          contentEditable={props.editable()}
        ></div>
        <DecoratorRenderer editor={editor} />
        <NodeAccessoryRenderer editor={editor} store={accessoryStore} />
        <Show when={showPlaceholder()}>
          <div class="pointer-events-none text-ink-extra-muted absolute top-0">
            <p class="my-1.5 pointer-events-none">
              {props.placeholder ?? '...'}
            </p>
          </div>
        </Show>
        <MentionsMenu
          editor={editor}
          menu={mentionsMenuOperations}
          anchor={props.anchor}
          onUserMention={props.onUserMention}
          onDocumentMention={props.onDocumentMention}
          useBlockBoundary={props.useBlockBoundary}
          portalScope={props.portalScope}
          emails={() => []}
        />
        <EmojiMenu
          editor={editor}
          menu={emojisMenuOperations}
          portalScope={props.portalScope}
          useBlockBoundary={props.useBlockBoundary}
        />
        <FloatingMenuGroup>
          <FloatingLinkMenu />
        </FloatingMenuGroup>
      </div>
    </LexicalWrapperContext.Provider>
  );
}
