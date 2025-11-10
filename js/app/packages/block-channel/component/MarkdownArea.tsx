import { DecoratorRenderer } from '@core/component/LexicalMarkdown/component/core/DecoratorRenderer';
import { NodeAccessoryRenderer } from '@core/component/LexicalMarkdown/component/core/NodeAccessoryRenderer';
import { EmojiMenu } from '@core/component/LexicalMarkdown/component/menu/EmojiMenu';
import { FloatingLinkMenu } from '@core/component/LexicalMarkdown/component/menu/FloatingLinkMenu';
import { MentionsMenu } from '@core/component/LexicalMarkdown/component/menu/MentionsMenu';
import {
  createLexicalWrapper,
  type LexicalWrapper,
  LexicalWrapperContext,
} from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import {
  autoRegister,
  customSelectionDataPlugin,
  DefaultShortcuts,
  defaultSelectionData,
  type ItemMention,
  keyboardFocusPlugin,
  keyboardShortcutsPlugin,
  markdownPastePlugin,
  mentionsPlugin,
  NODE_TRANSFORM,
  type NodeTransformType,
  type SelectionData,
  tabIndentationPlugin,
  tableCellResizerPlugin,
  tablePlugin,
} from '@core/component/LexicalMarkdown/plugins';
import { codePlugin } from '@core/component/LexicalMarkdown/plugins/code/codePlugin';
import { emojisPlugin } from '@core/component/LexicalMarkdown/plugins/emojis/emojisPlugin';
import { createMenuOperations } from '@core/component/LexicalMarkdown/shared/inlineMenu';
import {
  editorIsEmpty,
  initializeEditorEmpty,
  insertText,
  setEditorStateFromMarkdown,
} from '@core/component/LexicalMarkdown/utils';
import type { PortalScope } from '@core/component/ScopedPortal';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import type { IUser } from '@core/user';
import type { Item } from '@service-storage/generated/schemas/item';
import { filePastePlugin } from 'core/component/LexicalMarkdown/plugins/file-paste/filePastePlugin';
import { createAccessoryStore } from 'core/component/LexicalMarkdown/plugins/node-accessory/nodeAccessoryPlugin';
import { normalizeEnterPlugin } from 'core/component/LexicalMarkdown/plugins/normalize-enter/';
import { textPastePlugin } from 'core/component/LexicalMarkdown/plugins/text-paste/textPastePlugin';
import {
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  FORMAT_TEXT_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  type LexicalEditor,
  type TextFormatType,
} from 'lexical';
import {
  type Accessor,
  createEffect,
  createSignal,
  type JSXElement,
  onCleanup,
  onMount,
  type Setter,
  Show,
} from 'solid-js';
import { createStore, type SetStoreFunction } from 'solid-js/store';

export type UseChannelMarkdown = {
  focus: () => void;
  blur: () => void;
  mentions: Accessor<ItemMention[]>;
  state: Accessor<string>;
  formatState: SelectionData;
  clear: () => void;
  ref: Accessor<HTMLDivElement | undefined>;
  insert: (value: string) => void;
  MarkdownArea: (props: ConsumableMarkdownAreaProps) => JSXElement;
  setInlineFormat: (format: TextFormatType) => void;
  setNodeFormat: (transform: NodeTransformType) => void;
  editor: LexicalEditor;
};

export function useChannelMarkdownArea(): UseChannelMarkdown {
  const [mentions, setMentions] = createSignal<ItemMention[]>([]);
  const [state, setState] = createSignal<string>('');
  const [mountRef, setMountRef] = createSignal<HTMLDivElement>();
  const [formatState, setFormatState] = createStore<SelectionData>(
    structuredClone(defaultSelectionData)
  );

  const lexicalWrapper = createLexicalWrapper({
    type: 'chat',
    namespace: 'channel-markdown-area',
    isInteractable: () => true,
  });

  function focus() {
    setTimeout(() => {
      lexicalWrapper.editor.focus();
    }, 0);
  }

  function blur() {
    lexicalWrapper.editor.blur();
  }

  function insert(text: string) {
    insertText(lexicalWrapper.editor, text);
  }

  function inlineFormat(format: TextFormatType): void {
    lexicalWrapper.editor.focus();
    lexicalWrapper.editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
  }

  function nodeFormat(transform: NodeTransformType): void {
    lexicalWrapper.editor.focus();
    lexicalWrapper.editor.dispatchCommand(NODE_TRANSFORM, transform);
  }

  function ChannelMarkdownArea(props: ConsumableMarkdownAreaProps) {
    return (
      <MarkdownArea
        mountRef={mountRef}
        setMountRef={setMountRef}
        setMentions={setMentions}
        markdownState={state}
        setMarkdownState={setState}
        lexicalWrapper={lexicalWrapper}
        formatState={formatState}
        setFormatState={setFormatState}
        {...props}
      />
    );
  }

  function clear() {
    initializeEditorEmpty(lexicalWrapper.editor);
    lexicalWrapper.editor.read(() => {});
    setMentions([]);
  }

  return {
    insert,
    MarkdownArea: ChannelMarkdownArea,
    focus,
    blur,
    mentions,
    state,
    ref: mountRef,
    clear,
    formatState,
    setInlineFormat: inlineFormat,
    setNodeFormat: nodeFormat,
    editor: lexicalWrapper.editor,
  };
}

type MarkdownAreaProps = {
  mountRef: Accessor<HTMLDivElement | undefined>;
  setMountRef: Setter<HTMLDivElement | undefined>;
  setMentions: Setter<ItemMention[]>;
  markdownState: Accessor<string>;
  setMarkdownState: Setter<string>;
  lexicalWrapper: LexicalWrapper;
  setFormatState: SetStoreFunction<SelectionData>;
  formatState: SelectionData;
};

export type ConsumableMarkdownAreaProps = {
  onChange?: (value: string) => void;
  onEnter?: (e: KeyboardEvent) => boolean;
  onBlur?: () => void;
  onEscape?: (e: KeyboardEvent) => boolean;
  onTab?: (e: KeyboardEvent) => boolean;
  onFocusLeaveStart?: (e: KeyboardEvent) => void;
  onFocusLeaveEnd?: (e: KeyboardEvent) => void;
  initialValue?: string;
  placeholder?: string;
  users?: Accessor<IUser[]>;
  history?: Accessor<Item[]>;
  onPasteFilesAndDirs?: (
    files: FileSystemFileEntry[],
    directories: FileSystemDirectoryEntry[]
  ) => void;
  dontFocusOnMount?: boolean;
  disableMentions?: boolean;
  useBlockBoundary?: boolean;
  portalScope?: PortalScope;
};

function MarkdownArea(props: MarkdownAreaProps & ConsumableMarkdownAreaProps) {
  const { editor, plugins, cleanup } = props.lexicalWrapper;

  onMount(() => {
    editor.setRootElement(props.mountRef()!);
    editor.setEditable(true);
    if (props.initialValue) {
      setEditorStateFromMarkdown(editor, props.initialValue);
    } else {
      initializeEditorEmpty(editor);
    }
    if (!isMobileWidth() && !props.dontFocusOnMount) {
      editor.focus();
    }
  });
  createEffect(() => {
    props.onChange?.(props.markdownState());
  });

  const [showPlaceholder, setShowPlaceholder] = createSignal(true);

  const mentionsMenuOperations = createMenuOperations();
  const emojisMenuOperations = createMenuOperations();

  const menuIsOpen = () => {
    return mentionsMenuOperations.isOpen() || emojisMenuOperations.isOpen();
  };

  const [accessories, setAccessories] = createAccessoryStore();

  plugins
    .richText()
    .list()
    .markdownShortcuts()
    .delete()
    .state<string>(props.setMarkdownState, 'markdown')
    .history(400)
    .use(
      customSelectionDataPlugin(
        props.lexicalWrapper,
        props.formatState,
        props.setFormatState
      )
    )
    .use(emojisPlugin({ menu: emojisMenuOperations }))
    .use(codePlugin({ accessories, setAccessories }))
    .use(tabIndentationPlugin())
    .use(textPastePlugin())
    .use(markdownPastePlugin())
    .use(normalizeEnterPlugin())
    .use(
      tablePlugin({
        hasCellMerge: true,
        hasCellBackgroundColor: false,
        hasTabHandler: true,
        hasHorizontalScroll: true,
      })
    )
    .use(
      keyboardShortcutsPlugin({
        shortcuts: DefaultShortcuts,
      })
    )
    .use(tableCellResizerPlugin());

  if (props.onFocusLeaveEnd || props.onFocusLeaveStart) {
    plugins.use(
      keyboardFocusPlugin({
        onFocusLeaveStart: props.onFocusLeaveStart,
        onFocusLeaveEnd: props.onFocusLeaveEnd,
        ignoreKeys: menuIsOpen,
      })
    );
  }

  if (!props.disableMentions) {
    plugins.use(
      mentionsPlugin({
        menu: mentionsMenuOperations,
        setMentions: props.setMentions,
      })
    );
  }

  if (props.onPasteFilesAndDirs) {
    plugins.use(
      filePastePlugin({
        onPasteFilesAndDirs: props.onPasteFilesAndDirs,
      })
    );
  }

  if (props.onEnter !== undefined) {
    autoRegister(
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (e: KeyboardEvent) => {
          // TODO (seamus) : This is hacky. If we got a props.onEnter,then shift+enter becomes
          // the new "regular enter", so we delete the shiftKey and pass along to lexical.
          if (e.shiftKey) {
            Object.defineProperty(e, 'shiftKey', { value: false });
            return false;
          }

          const captured = props.onEnter!(e);
          if (captured) {
            e.preventDefault();
            e.stopPropagation();
          }
          return captured;
        },
        // Run at HIGH here to that the mentions menu can run at CRITICAL
        COMMAND_PRIORITY_HIGH
      )
    );
  }

  onCleanup(() => {
    cleanup();
  });

  createEffect(() => {
    props.markdownState();
    setShowPlaceholder(editorIsEmpty(editor));
  });

  autoRegister(
    editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      (e) => {
        return props.onEscape ? props.onEscape(e) : false;
      },
      COMMAND_PRIORITY_CRITICAL
    ),
    editor.registerCommand(
      KEY_TAB_COMMAND,
      (e) => {
        return props.onTab ? props.onTab(e) : false;
      },
      COMMAND_PRIORITY_CRITICAL
    )
  );

  return (
    <LexicalWrapperContext.Provider value={props.lexicalWrapper}>
      <div class="relative w-full min-h-8">
        <div ref={(el) => props.setMountRef(el)} contentEditable={true}></div>
        <DecoratorRenderer editor={editor} />
        <NodeAccessoryRenderer editor={editor} store={accessories} />
        <Show when={showPlaceholder()}>
          <div class="pointer-events-none text-ink-placeholder absolute top-0">
            <p class="p-0 m-0 text-ink-placeholder">
              {props.placeholder ?? '...'}
            </p>
          </div>
        </Show>
        <EmojiMenu
          editor={editor}
          menu={emojisMenuOperations}
          useBlockBoundary={props.useBlockBoundary}
          portalScope={props.portalScope}
        />
        <Show when={!props.disableMentions}>
          <MentionsMenu
            editor={editor}
            menu={mentionsMenuOperations}
            users={props.users}
            history={props.history}
            block={'channel'}
            useBlockBoundary={props.useBlockBoundary}
            portalScope={props.portalScope}
            emails={() => []}
          />
        </Show>
        <FloatingLinkMenu />
      </div>
    </LexicalWrapperContext.Provider>
  );
}
