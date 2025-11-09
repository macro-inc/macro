import type { PortalScope } from '@core/component/ScopedPortal';
import {
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
  type LexicalEditor,
} from 'lexical';
import {
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  type Setter,
  Show,
} from 'solid-js';
import {
  type LexicalWrapperBase,
  LexicalWrapperContext,
} from '../../context/LexicalWrapperContext';
import {
  codePlugin,
  createAccessoryStore,
  type ItemMention,
  mentionsPlugin,
  selectionDataPlugin,
  tabIndentationPlugin,
} from '../../plugins';
import { createMenuOperations } from '../../shared/inlineMenu';
import {
  editorIsEmpty,
  initializeEditorEmpty,
  setEditorStateFromMarkdown,
} from '../../utils';
import { DecoratorRenderer } from '../core/DecoratorRenderer';
import { MentionsMenu, type UserMentionRecord } from '../menu/MentionsMenu';

// Version of MarkdownTextArea modified for email to/cc/bcc input fields

export interface MentionsTextareaProps {
  wrapper: LexicalWrapperBase;
  onChange?: (value: string, editor?: LexicalEditor) => void;
  initialValue?: string;
  focusOnMount?: boolean;
  class?: string;
  anchor?: HTMLElement | null;
  onContactMention?: (mention: UserMentionRecord) => void;
  onRemoveMention?: (mention: ItemMention) => void;
  setMentions?: Setter<ItemMention[]>;
  ref?: (el: HTMLDivElement) => void;
  onTab?: () => void;
  portalScope?: PortalScope;
  placeholder?: string;
}

export function MentionsTextarea(props: MentionsTextareaProps) {
  let mountRef!: HTMLDivElement;
  const { editor, plugins, cleanup: cleanupLexical } = props.wrapper;

  const [markdownState, setMarkdownState] = createSignal<string>('');

  onMount(() => {
    // Prevent these from stealing focus on load/refresh
    mountRef.inert = true;
    setTimeout(() => {
      mountRef.inert = false;
    }, 0);

    if (!props.focusOnMount) return;
    setTimeout(() => {
      mountRef.focus();
    });
  });

  createEffect(() => {
    props.onChange?.(markdownState(), editor);
  });

  if (props.initialValue) {
    setEditorStateFromMarkdown(editor, props.initialValue);
  } else {
    initializeEditorEmpty(editor);
  }

  const [showPlaceholder, setShowPlaceholder] = createSignal(
    !!props.placeholder
  );

  const mentionsMenuOperations = createMenuOperations();

  plugins
    .richText()
    .list()
    .markdownShortcuts()
    .delete()
    .state<string>(setMarkdownState, 'markdown')
    .history(400)
    .use(selectionDataPlugin(props.wrapper))
    .use(tabIndentationPlugin())
    .use(
      mentionsPlugin({
        menu: mentionsMenuOperations,
        onRemoveMention: props.onRemoveMention,
        setMentions: props.setMentions,
      })
    );

  const [accessoryStore, setAccessoryStore] = createAccessoryStore();
  plugins.use(
    codePlugin({
      setAccessories: setAccessoryStore,
      accessories: accessoryStore,
    })
  );

  let cleanupEnterListener: () => void = () => {};
  createEffect(() => {
    cleanupEnterListener();
    cleanupEnterListener = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (e: KeyboardEvent) => {
        e.preventDefault();
        return true;
      },
      // Run at HIGH here so that the mentions menu can run at CRITICAL
      COMMAND_PRIORITY_HIGH
    );
  });

  // Assign ref to parent if provided
  createEffect(() => {
    if (props.ref) props.ref(mountRef);
  });

  let cleanupTabListener: () => void = () => {};
  createEffect(() => {
    cleanupTabListener();
    cleanupTabListener = editor.registerCommand(
      KEY_TAB_COMMAND,
      (e: KeyboardEvent) => {
        e.preventDefault();
        if (props.onTab) {
          props.onTab();
        }
        return true;
      },
      // Run at HIGH here so that the mentions menu can run at CRITICAL
      COMMAND_PRIORITY_HIGH
    );
  });

  onMount(() => {
    editor.setRootElement(mountRef);
  });

  onCleanup(() => {
    cleanupLexical();
  });

  if (props.placeholder) {
    createEffect(() => {
      markdownState();
      setShowPlaceholder(editorIsEmpty(editor));
    });
  }

  return (
    <LexicalWrapperContext.Provider value={props.wrapper}>
      <div
        class={`${props.class ?? ''} relative w-full h-full overflow-auto min-h-8 supress-css-brackets`}
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
          class="h-full min-h-8 max-h-24 overflow-y-auto supress-css-brackets"
          ref={mountRef}
          contentEditable
        />
        <Show when={showPlaceholder()}>
          <div class="pointer-events-none text-ink-placeholder absolute top-0">
            <p class="my-1.5">{props.placeholder}</p>
          </div>
        </Show>
        <DecoratorRenderer editor={editor} />
        <MentionsMenu
          editor={editor}
          menu={mentionsMenuOperations}
          anchor={props.anchor}
          onUserMention={props.onContactMention}
          history={() => []}
          channels={() => []}
          portalScope={props.portalScope}
          emails={() => []}
        />
      </div>
    </LexicalWrapperContext.Provider>
  );
}
