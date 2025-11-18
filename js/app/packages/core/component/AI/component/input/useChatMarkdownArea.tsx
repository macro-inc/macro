import { withAnalytics } from '@coparse/analytics';
import { useGetChatAttachmentInfo } from '@core/component/AI/signal/attachment';
import type { Attachment } from '@core/component/AI/types';
import { DecoratorRenderer } from '@core/component/LexicalMarkdown/component/core/DecoratorRenderer';
import { NodeAccessoryRenderer } from '@core/component/LexicalMarkdown/component/core/NodeAccessoryRenderer';
import { EmojiMenu } from '@core/component/LexicalMarkdown/component/menu/EmojiMenu';
import { FloatingLinkMenu } from '@core/component/LexicalMarkdown/component/menu/FloatingLinkMenu';
import { MentionsMenu } from '@core/component/LexicalMarkdown/component/menu/MentionsMenu';
import { FloatingMenuGroup } from '@core/component/LexicalMarkdown/context/FloatingMenuContext';
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
  registerRootEventListener,
  type SelectionData,
  tabIndentationPlugin,
  tableCellResizerPlugin,
  tablePlugin,
} from '@core/component/LexicalMarkdown/plugins';
import { codePlugin } from '@core/component/LexicalMarkdown/plugins/code/codePlugin';
import { emojisPlugin } from '@core/component/LexicalMarkdown/plugins/emojis/emojisPlugin';
import { normalizeEnterPlugin } from '@core/component/LexicalMarkdown/plugins/normalize-enter/';
import { createMenuOperations } from '@core/component/LexicalMarkdown/shared/inlineMenu';
import {
  $traverseNodes,
  editorIsEmpty,
  initializeEditorEmpty,
  insertText,
  setEditorStateFromMarkdown,
} from '@core/component/LexicalMarkdown/utils';
import type { PortalScope } from '@core/component/ScopedPortal';
import { shortcutBadgeStyles } from '@core/component/Themes';
import { TOKENS } from '@core/hotkey/tokens';
import { getPretyHotkeyStringByToken } from '@core/hotkey/utils';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import type { IOrganizationUser } from '@core/user';
import { $isDocumentMentionNode } from '@lexical-core';
import type { Item } from '@service-storage/generated/schemas/item';
import { activeElement } from 'app/signal/focus';
import { filePastePlugin } from 'core/component/LexicalMarkdown/plugins/file-paste/filePastePlugin';
import { createAccessoryStore } from 'core/component/LexicalMarkdown/plugins/node-accessory/nodeAccessoryPlugin';
import { textPastePlugin } from 'core/component/LexicalMarkdown/plugins/text-paste/textPastePlugin';
import {
  $getRoot,
  COMMAND_PRIORITY_HIGH,
  FORMAT_TEXT_COMMAND,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
  type TextFormatType,
} from 'lexical';
import {
  type Accessor,
  createEffect,
  createSignal,
  type JSXElement,
  on,
  onCleanup,
  type Setter,
  Show,
} from 'solid-js';
import { createStore, type SetStoreFunction } from 'solid-js/store';

const { track, TrackingEvents } = withAnalytics();

export type UseChatMarkdown = {
  focus: () => void;
  mentions: Accessor<ItemMention[]>;
  markdownText: Accessor<string>;
  formatState: SelectionData;
  clear: () => void;
  ref: Accessor<HTMLDivElement | undefined>;
  insert: (value: string) => void;
  MarkdownArea: (props: ConsumableChatMarkdownAreaProps) => JSXElement;
  setInlineFormat: (format: TextFormatType) => void;
  setNodeFormat: (transform: NodeTransformType) => void;
  removeMention: (mentionId: string) => void;
};

export type useChatMarkdownAreaArgs = {
  initialValue?: string;
  addAttachment: (attachment: Attachment) => void;
};

export function useChatMarkdownArea(
  args: useChatMarkdownAreaArgs
): UseChatMarkdown {
  const [mentions, setMentions] = createSignal<ItemMention[]>([]);
  const [state, setState] = createSignal<string>('');
  const [mountRef, setMountRef] = createSignal<HTMLDivElement>();
  const [formatState, setFormatState] = createStore<SelectionData>(
    structuredClone(defaultSelectionData)
  );

  const lexicalWrapper = createLexicalWrapper({
    type: 'chat',
    namespace: 'chat-markdown-area',
    isInteractable: () => true,
  });

  function focus() {
    setTimeout(() => {
      lexicalWrapper.editor.focus();
    }, 0);
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

  function clear() {
    initializeEditorEmpty(lexicalWrapper.editor);
    setMentions([]);
  }
  function removeMention(mentionId: string) {
    lexicalWrapper.editor.update(() => {
      const root = $getRoot();
      let nodeToRemove: any = null;

      // Find the document mention node with the given ID
      $traverseNodes(root, (node: any) => {
        if (
          $isDocumentMentionNode(node) &&
          node.getDocumentId() === mentionId
        ) {
          nodeToRemove = node;
          return true;
        }
        return false;
      });

      if (nodeToRemove) {
        // Remove the node from the editor
        nodeToRemove.remove();

        // Update the mentions state to remove this mention
        setMentions((prev) => prev.filter((m) => m.itemId !== mentionId));
      }
    });
  }

  const { getAttachmentFromMention } = useGetChatAttachmentInfo();
  const addAttachmentFromMention = (mention: ItemMention) => {
    track(TrackingEvents.CHAT.MENTION.SELECT);
    const attachment = getAttachmentFromMention(mention);
    if (attachment) args.addAttachment(attachment);
  };

  function ChatMarkdownArea(props: ConsumableChatMarkdownAreaProps) {
    return (
      <MarkdownArea
        initialValue={args.initialValue}
        mountRef={mountRef}
        setMountRef={setMountRef}
        markdownState={state}
        setMarkdownState={setState}
        lexicalWrapper={lexicalWrapper}
        formatState={formatState}
        setFormatState={setFormatState}
        onCreateMention={addAttachmentFromMention}
        {...props}
      />
    );
  }

  return {
    insert,
    MarkdownArea: ChatMarkdownArea,
    focus,
    mentions,
    markdownText: state,
    ref: mountRef,
    clear,
    formatState,
    setInlineFormat: inlineFormat,
    setNodeFormat: nodeFormat,
    removeMention,
  };
}

type MarkdownAreaProps = {
  mountRef: Accessor<HTMLDivElement | undefined>;
  setMountRef: Setter<HTMLDivElement | undefined>;
  onCreateMention: (mention: ItemMention) => void;
  markdownState: Accessor<string>;
  setMarkdownState: Setter<string>;
  lexicalWrapper: LexicalWrapper;
  setFormatState: SetStoreFunction<SelectionData>;
  formatState: SelectionData;
};

export type ConsumableChatMarkdownAreaProps = {
  onChange?: (value: string) => void;
  onEnter?: (e: KeyboardEvent) => boolean;
  onBlur?: () => void;
  initialValue?: string;
  placeholder?: string;
  users?: Accessor<IOrganizationUser[]>;
  history?: Accessor<Item[]>;
  onPasteFile?: (files: File[]) => void;
  dontFocusOnMount?: boolean;
  portalScope?: PortalScope;
  onFocusLeaveStart?: (e: KeyboardEvent) => void;
  onFocusLeaveEnd?: (e: KeyboardEvent) => void;
  captureEditor?: (editor: LexicalEditor) => void;
};

function MarkdownArea(
  props: MarkdownAreaProps & ConsumableChatMarkdownAreaProps
) {
  const { editor, plugins, cleanup } = props.lexicalWrapper;

  // TODO: ask peter what do
  // const hotkeyScope = blockHotkeyScopeSignal.get;
  const isActiveElementInBlock = () => {
    return false;
    // const blockElement = blockElementSignal.get();
    // const currentActiveElement = activeElement();

    // if (!blockElement || !currentActiveElement) {
    //   return false;
    // }

    // return blockElement.contains(currentActiveElement);
  };

  // onMount(() => {
  //   registerHotkey({
  //     hotkeyToken: 'chat-input-focus',
  //     scopeId: 'TODO-chatimus', // TODO
  //     description: 'Focus chat input',
  //     hotkey: 't',
  //     keyDownHandler: () => {
  //       editor.focus();
  //       return true;
  //     },
  //   });
  // });

  const focusShortcut = getPretyHotkeyStringByToken(TOKENS.chat.input.focus);

  createEffect(
    on(props.mountRef, (ref) => {
      console.log('EFFECT ON REF', ref);
      if (!ref) return;
      editor.setRootElement(ref);
      editor.setEditable(true);
      if (props.initialValue) {
        setEditorStateFromMarkdown(editor, props.initialValue);
      } else {
        initializeEditorEmpty(editor);
      }
      if (!isMobileWidth() && !props.dontFocusOnMount) {
        editor.focus();
      }
    })
  );

  if (props.captureEditor) {
    props.captureEditor(editor);
  }

  createEffect(() => {
    props.onChange?.(props.markdownState());
  });

  const [showPlaceholder, setShowPlaceholder] = createSignal(true);

  const mentionsMenuOperations = createMenuOperations();
  const emojisMenuOperations = createMenuOperations();

  const [accessories, setAccessories] = createAccessoryStore();

  onCleanup(() => {
    cleanup();
  });

  createEffect(() => {
    props.markdownState();
    setShowPlaceholder(editorIsEmpty(editor));
  });

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
    .use(
      filePastePlugin({
        onPaste: (files: File[]) => {
          if (props.onPasteFile) {
            props.onPasteFile(files);
          }
        },
      })
    )
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
    .use(tableCellResizerPlugin())
    .use(
      mentionsPlugin({
        menu: mentionsMenuOperations,
        onCreateMention: props.onCreateMention,
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

  if (props.onEnter !== undefined) {
    autoRegister(
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (e: KeyboardEvent) => {
          // TODO (seamus) : This is hacky. If we got a props.onEnter,then shift+enter becomes
          // the new "", so we delete the shiftKey and pass along to lexical.
          if (e.shiftKey) {
            Object.defineProperty(e, 'shiftKey', { value: false });
            return false;
          }

          const captured = props.onEnter!(e);
          setTimeout(() => {
            editor.focus();
          }, 0);
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

  // better focus in handling. preserves selection on regain focus!
  autoRegister(
    registerRootEventListener(editor, 'focusin', (e) => {
      e.preventDefault();
      editor.focus();
    })
  );

  onCleanup(() => {
    cleanup();
  });

  return (
    <LexicalWrapperContext.Provider value={props.lexicalWrapper}>
      <div class="relative w-full">
        <div
          ref={(el) => props.setMountRef(el)}
          contentEditable={true}
          class="overflow-y-auto max-h-40 p-0 m-0"
        ></div>
        <DecoratorRenderer editor={editor} />
        <NodeAccessoryRenderer editor={editor} store={accessories} />
        <Show when={showPlaceholder()}>
          <div class="pointer-events-none absolute top-0">
            <Show
              when={
                activeElement() !== props.mountRef() && isActiveElementInBlock()
              }
              fallback={
                <p class="py-1.5 p-0 text-ink-extra-muted">
                  {props.placeholder ?? 'Ask AI @mention anything'}
                </p>
              }
            >
              <p class="p-0 m-0 text-ink-extra-muted">
                Press{' '}
                <span
                  class={`rounded-md px-1.5 py-0.5 space-x-1 ${shortcutBadgeStyles['muted']}`}
                >
                  {focusShortcut}
                </span>{' '}
                to chat with AI
              </p>
            </Show>
          </div>
        </Show>
        <EmojiMenu
          editor={editor}
          menu={emojisMenuOperations}
          useBlockBoundary={true}
          portalScope={props.portalScope}
        />
        <MentionsMenu
          editor={editor}
          menu={mentionsMenuOperations}
          users={() => []}
          // NOTE: we use default channel history
          history={props.history}
          block={'chat'}
          useBlockBoundary={true}
          portalScope={props.portalScope}
        />
        <FloatingMenuGroup>
          <FloatingLinkMenu />
        </FloatingMenuGroup>
      </div>
    </LexicalWrapperContext.Provider>
  );
}
