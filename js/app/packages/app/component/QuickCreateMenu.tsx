import { BozzyBracketInnerSibling } from '@core/component/BozzyBracket';
import { GlitchText } from '@core/component/GlitchText';
import { Hotkey } from '@core/component/Hotkey';
import { DecoratorRenderer } from '@core/component/LexicalMarkdown/component/core/DecoratorRenderer';
import { NodeAccessoryRenderer } from '@core/component/LexicalMarkdown/component/core/NodeAccessoryRenderer';
import { ActionMenu } from '@core/component/LexicalMarkdown/component/menu/ActionsMenu';
import { EmojiMenu } from '@core/component/LexicalMarkdown/component/menu/EmojiMenu';
import { MentionsMenu } from '@core/component/LexicalMarkdown/component/menu/MentionsMenu';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import {
  actionsPlugin,
  autoRegister,
  DefaultShortcuts,
  type ItemMention,
  keyboardShortcutsPlugin,
  linksPlugin,
  markdownPastePlugin,
  mentionsPlugin,
  NODE_TRANSFORM,
  type NodeTransformType,
  selectionDataPlugin,
  tabIndentationPlugin,
} from '@core/component/LexicalMarkdown/plugins';
import { codePlugin } from '@core/component/LexicalMarkdown/plugins/code/codePlugin';
import { emojisPlugin } from '@core/component/LexicalMarkdown/plugins/emojis/emojisPlugin';
import { createAccessoryStore } from '@core/component/LexicalMarkdown/plugins/node-accessory';
import { textPastePlugin } from '@core/component/LexicalMarkdown/plugins/text-paste/textPastePlugin';
import { createMenuOperations } from '@core/component/LexicalMarkdown/shared/inlineMenu';
import {
  editorIsEmpty,
  initializeEditorEmpty,
} from '@core/component/LexicalMarkdown/utils';
import { getDestinationFromOptions } from '@core/component/NewMessage';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { TextButton } from '@core/component/TextButton';
import { toast } from '@core/component/Toast/Toast';
import { LabelAndHotKey, Tooltip } from '@core/component/Tooltip';
import { IS_MAC } from '@core/constant/isMac';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import type { ContactInfo, WithCustomUserInput } from '@core/user';
import { useSendMessageToPeople } from '@core/util/channels';
import { createMarkdownFile } from '@core/util/create';
import { isErr } from '@core/util/maybeResult';
import TextBold from '@icon/bold/text-b-bold.svg';
import CommentIcon from '@icon/regular/chat-circle-text.svg';
import TextCode from '@icon/regular/code.svg';
import EnvelopeIcon from '@icon/regular/envelope.svg';
import ListBullets from '@icon/regular/list-bullets.svg';
import ListChecks from '@icon/regular/list-checks.svg';
import ListNumbers from '@icon/regular/list-numbers.svg';
import NoteIcon from '@icon/regular/note.svg';
import FormatIcon from '@icon/regular/text-aa.svg';
import TextItalic from '@icon/regular/text-italic.svg';
import TextStriketrough from '@icon/regular/text-strikethrough.svg';
import { Dialog } from '@kobalte/core/dialog';
import { $generateHtmlFromNodes } from '@lexical/html';
import MacroGridLoader from '@macro-icons/macro-grid-noise-loader-4.svg';
import type { SimpleMention } from '@service-comms/generated/models/simpleMention';
import { emailClient } from '@service-email/client';
import type { MessageToSend } from '@service-email/generated/schemas/messageToSend';
import { normalizeEnterPlugin } from 'core/component/LexicalMarkdown/plugins/normalize-enter';
import {
  $getRoot,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  FORMAT_TEXT_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  type TextFormatType,
} from 'lexical';
import {
  type Accessor,
  createMemo,
  createSignal,
  For,
  type JSXElement,
  Match,
  onCleanup,
  onMount,
  type ParentProps,
  type Setter,
  Show,
  type Signal,
  Switch,
  useContext,
} from 'solid-js';
import { useEmailLinksStatus } from '../signal/emailLink';
import { useSplitLayout } from './split-layout/layout';

type CreateType = 'note' | 'email' | 'message';

interface QuickCreateConfig {
  id: CreateType;
  label: string;
  shortcut: string;
  icon: typeof NoteIcon;
}

const tabs: QuickCreateConfig[] = [
  { id: 'note', label: 'Note', shortcut: 'n', icon: NoteIcon },
  { id: 'email', label: 'Email', shortcut: 'e', icon: EnvelopeIcon },
  { id: 'message', label: 'Message', shortcut: 'm', icon: CommentIcon },
];

function mentionToSimpleMention({
  itemType,
  itemId,
}: ItemMention): SimpleMention {
  return {
    entity_type: itemType,
    entity_id: itemId,
  };
}

interface QuickCreateMenuProps {
  quickCreateMenuOpenSignal: Signal<boolean>;
  selectedTypeSignal: Signal<CreateType>;
}

export const quickCreateMenuOpenSignal = createSignal(false);
const [quickCreateMenuOpen, setQuickCreateMenuOpen] = quickCreateMenuOpenSignal;
export const selectedQuickCreateTypeSignal = createSignal<CreateType>('note');

export function QuickCreateMenu() {
  return (
    <Dialog
      open={quickCreateMenuOpen()}
      onOpenChange={setQuickCreateMenuOpen}
      modal={true}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-modal bg-modal-overlay" />
        <div class="fixed inset-0 z-modal w-screen h-screen flex items-center justify-center">
          <Dialog.Content class="flex items-center justify-center w-[620px]">
            <QuickCreateMenuInner
              quickCreateMenuOpenSignal={quickCreateMenuOpenSignal}
              selectedTypeSignal={selectedQuickCreateTypeSignal}
            />
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog>
  );
}

export function QuickCreateMenuInner(props: QuickCreateMenuProps) {
  let menuRef!: HTMLDivElement;
  // Item setup
  let tabButtonsRef: HTMLDivElement | undefined;
  const [selectedType, setSelectedType] = props.selectedTypeSignal;
  const [_, setCreateMenuOpen] = props.quickCreateMenuOpenSignal;
  let noteTitleRef: HTMLInputElement | undefined;
  const emailActive = useEmailLinksStatus();
  const [selectedEmailOptions, setSelectedEmailOptions] = createSignal<
    WithCustomUserInput<'user' | 'contact'>[]
  >([]);
  const [selectedOptions, setSelectedOptions] = createSignal<
    WithCustomUserInput<'user' | 'contact' | 'channel'>[]
  >([]);
  const [triedToSubmitEmail, _setTriedToSubmitEmail] = createSignal(false);

  const { users: usersAndContacts, all: destinationOptions } =
    useCombinedRecipients();

  const [triedToSubmit, _setTriedToSubmit] = createSignal(false);

  // Content Editor setup
  let contentContainerRef: HTMLDivElement | undefined;
  let editorContentRef: HTMLDivElement | undefined;
  const [content, setContent] = createSignal('');
  const [isInteractable, setIsInteractable] = createSignal(false);
  const lexicalWrapper = createLexicalWrapper({
    type: 'markdown',
    namespace: 'create-menu-content',
    isInteractable,
  });
  const { editor, plugins, cleanup } = lexicalWrapper;

  // Editor Plugins setup
  const [showFormatRibbon, setShowFormatRibbon] = createSignal(false);
  const [mentions, setMentions] = createSignal<ItemMention[]>([]);
  const mentionsMenuOperations = createMenuOperations();
  const emojisMenuOperations = createMenuOperations();
  const actionsMenuOperations = createMenuOperations();
  const [accessories, setAccessories] = createAccessoryStore();
  const { replaceOrInsertSplit } = useSplitLayout();

  // Submit handlers setup
  const createNewNote = async (goToNote = false) => {
    const documentId = await createMarkdownFile({
      content: content(),
      title: noteTitleRef?.value || '',
    });

    if (!documentId) {
      toast.failure('Failed to create note');
      return false;
    }

    if (goToNote && documentId) {
      replaceOrInsertSplit({
        type: 'md',
        id: documentId,
      });
      return true;
    }

    return true;
  };

  const sendEmail = async (goTo = false) => {
    // Extract recipients from selectedEmailOptions
    const options = selectedEmailOptions();
    if (options.length === 0) {
      toast.failure('Please add at least one recipient');
      return false;
    }

    // Convert selected options to email contacts
    const toContacts: ContactInfo[] = options.map((option) => {
      const email = option.data.email;

      const getNameFromEmail = (email: string) => email.split('@').at(0);
      let name: string | undefined;
      switch (option.kind) {
        case 'custom':
          name = getNameFromEmail(email);
          break;
        case 'contact':
          switch (option.data.type) {
            case 'extracted':
              name = getNameFromEmail(email);
              break;
            case 'person':
              name = option.data.name;
              break;
          }
          break;
        default:
          name = option.data.name;
      }

      return {
        email,
        name,
      };
    });

    // Get email links for new emails
    const fallbackLinks = await emailClient.getLinks();
    if (isErr(fallbackLinks) || fallbackLinks[1].links.length < 1) {
      toast.failure('Failed to send email');
      return false;
    }

    const parser = new DOMParser();
    const dom = editor
      .getEditorState()
      .read(() =>
        parser.parseFromString($generateHtmlFromNodes(editor), 'text/html')
      );
    const body_html = btoa(unescape(encodeURIComponent(dom.body.outerHTML)))
      .replace(/\+/g, '-') // Convert '+' to '-'
      .replace(/\//g, '_') // Convert '/' to '_'
      .replace(/={1,}$/, ''); // Remove padding '='
    const body_text = editor.read(() => $getRoot().getTextContent());
    const body_macro = content();

    const message: MessageToSend = {
      to: toContacts,
      cc: [],
      bcc: [],
      subject: '', // CreateMenu doesn't have a subject field yet
      body_html,
      body_text,
      body_macro,
      link_id: fallbackLinks[1].links[0].id,
    };

    const sendRequest = await emailClient.sendMessage({
      message,
    });

    if (isErr(sendRequest)) {
      toast.failure('Failed to send email');
      return false;
    }

    if (goTo) {
      replaceOrInsertSplit({
        type: 'email',
        id: 'new',
      });
    }

    return true;
  };

  const { sendToUsers, sendToChannel } = useSendMessageToPeople();
  const sendMessage = (goTo = false) => {
    const options = selectedOptions();
    if (!options || options.length === 0) {
      toast.failure('Please select at least one recipient');
      return false;
    }

    const destination = getDestinationFromOptions(options);
    if (!destination) return;

    if (destination.type === 'users') {
      return sendToUsers({
        users: destination.users,
        content: content(),
        mentions: mentions().map(mentionToSimpleMention),
        navigate: { navigate: goTo },
      }).then((res) => {
        if (res) {
          toast.success('Message sent successfully');
        } else {
          toast.failure('Failed to send message');
        }
        return res;
      });
    } else if (destination.type === 'channel') {
      return sendToChannel({
        channelId: destination.id,
        content: content(),
        mentions: mentions().map(mentionToSimpleMention),
        navigate: { navigate: goTo },
      }).then((res) => {
        if (res) {
          toast.success('Message sent successfully');
        } else {
          toast.failure('Failed to send message');
        }
        return res;
      });
    }
  };

  const [isLoading, setIsLoading] = createSignal(false);

  const submit = async (goTo = false) => {
    let success = false;
    switch (selectedType()) {
      case 'note':
        setIsLoading(true);
        success = await createNewNote(goTo);
        setIsLoading(false);
        break;
      case 'email':
        setIsLoading(true);
        success = await sendEmail();

        setIsLoading(false);
        break;
      case 'message':
        setIsLoading(true);
        success = !!(await sendMessage(goTo));

        setIsLoading(false);
        break;
    }
    if (success) {
      setCreateMenuOpen(false);
    } else {
      toast.failure('Failed');
    }
  };

  const contentPlaceHolder = createMemo(() => {
    content();
    if (!editorIsEmpty(editor)) return;

    if (!isInteractable()) return 'Press Tab or click to start writing...';

    switch (selectedType()) {
      case 'note':
      case 'email':
      case 'message':
        return `Press '/' for commands, '@' to reference files or people.`;
    }
  });

  plugins
    .richText()
    .list()
    .markdownShortcuts()
    .delete()
    .state<string>(setContent, 'markdown')
    .use(selectionDataPlugin(lexicalWrapper))
    .use(emojisPlugin({ menu: emojisMenuOperations }))
    .use(
      codePlugin({
        accessories: accessories,
        setAccessories: setAccessories,
      })
    )
    .use(tabIndentationPlugin())
    .use(textPastePlugin())
    .use(markdownPastePlugin())
    .use(normalizeEnterPlugin())
    .use(
      keyboardShortcutsPlugin({
        shortcuts: DefaultShortcuts,
      })
    )
    .use(
      mentionsPlugin({
        menu: mentionsMenuOperations,
        setMentions,
      })
    )
    .use(
      actionsPlugin({
        menu: actionsMenuOperations,
      })
    )
    .use(linksPlugin({}));

  const focusEditor = () => {
    setIsInteractable(true);
    editor.setEditable(true);
    editor.focus();
  };

  const returnFocusToMenu = () => {
    menuRef.focus();
  };

  autoRegister(
    editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      (e: KeyboardEvent) => {
        returnFocusToMenu();
        e.preventDefault();
        e.stopPropagation();
        return true;
      },
      COMMAND_PRIORITY_CRITICAL
    ),
    editor.registerCommand(
      KEY_ENTER_COMMAND,
      (e: KeyboardEvent) => {
        if (e.shiftKey) {
          Object.defineProperty(e, 'shiftKey', { value: false });
          return false;
        }

        e.preventDefault();
        e.stopPropagation();
        const goTo = (!IS_MAC && e.ctrlKey) || (IS_MAC && e.metaKey);
        submit(goTo);
        return true;
      },
      // Run at HIGH here to that the mentions menu can run at CRITICAL
      COMMAND_PRIORITY_HIGH
    )
  );

  // Hotkeys setup
  const [attachSelectionTypeHotkeys, typeSelectionHotKeyScope] =
    useHotkeyDOMScope('create-menu.type', true);
  registerHotkey({
    hotkey: 'n',
    scopeId: typeSelectionHotKeyScope,
    description: 'select note',
    keyDownHandler: () => {
      setSelectedType('note');
      return true;
    },
  });
  registerHotkey({
    hotkey: 'e',
    scopeId: typeSelectionHotKeyScope,
    description: 'select email',
    keyDownHandler: () => {
      if (!emailActive()) {
        toast.failure('Please enable email in settings first');
        return false;
      }

      setSelectedType('email');
      return true;
    },
  });

  registerHotkey({
    hotkey: 'm',
    scopeId: typeSelectionHotKeyScope,
    description: 'select message',
    keyDownHandler: () => {
      setSelectedType('message');
      return true;
    },
  });

  const [attachContentHotkeys, contentHotKeyScope] = useHotkeyDOMScope(
    'create-menu.content',
    false
  );
  registerHotkey({
    hotkey: 'tab',
    scopeId: contentHotKeyScope,
    description: 'focus content',
    keyDownHandler: () => {
      focusEditor();
      return true;
    },
    runWithInputFocused: true,
  });

  registerHotkey({
    hotkey: 'tab',
    scopeId: typeSelectionHotKeyScope,
    description: 'focus content',
    keyDownHandler: () => {
      return false;
    },
    runWithInputFocused: true,
  });

  registerHotkey({
    hotkey: 'escape',
    scopeId: contentHotKeyScope,
    description: 'change type',
    keyDownHandler: () => {
      returnFocusToMenu();
      return true;
    },
    runWithInputFocused: true,
  });

  registerHotkey({
    hotkeyToken: TOKENS.global.quickCreate.menuFormat,
    hotkey: 'cmd+f',
    scopeId: contentHotKeyScope,
    description: 'Toggle Format',
    keyDownHandler: () => {
      setShowFormatRibbon((v) => !v);
      return true;
    },
    runWithInputFocused: true,
  });

  onMount(() => {
    if (!editorContentRef || !tabButtonsRef || !menuRef || !contentContainerRef)
      return;
    editor.setRootElement(editorContentRef);
    attachSelectionTypeHotkeys(menuRef);
    attachContentHotkeys(contentContainerRef);
    initializeEditorEmpty(editor);
    menuRef.focus();
  });

  onCleanup(() => cleanup());

  return (
    <div
      class="relative flex flex-col w-5/6 max-w-xl bg-dialog border-edge border-1 shadow-lg text-ink placeholder:text-ink-placeholder suppress-css-brackets pulse-corners portal-scope"
      tabindex={-1}
      ref={(ref) => {
        menuRef = ref;
      }}
    >
      <BozzyBracketInnerSibling animOnOpen={true} />
      <Show when={isLoading()}>
        <div class="absolute top-0 left-0 w-full h-full z-10 bg-modal-overlay stripe-diagonal-8 flex items-center justify-center">
          <div class="flex flex-col items-center justify-center">
            <div class="p-2 font-mono text-sm flex items-center gap-2">
              <MacroGridLoader width={20} height={20} class="text-accent" />
              <GlitchText from="Synthesizing request..." continuous />
            </div>
          </div>
        </div>
      </Show>

      {/* Type */}
      <div class="px-4 pt-4 w-auto suppress-css-brackets" tabindex={-1}>
        <div class="dotted-banner" tabIndex={-1}>
          <div class="w-auto inline-block bg-dialog ml-4" tabindex={-1}>
            <div
              class="flex pb-0 w-auto suppress-css-brackets"
              ref={tabButtonsRef}
              tabindex={-1}
            >
              <For each={tabs}>
                {(tab) => (
                  <button
                    class={`flex items-center font-mono uppercase gap-1 px-2 py-2 text-sm font-medium transition-colors ${
                      selectedType() === tab.id
                        ? 'text-ink font-extrabold'
                        : 'text-ink-extra-muted hover:text-ink'
                    }`}
                    onClick={() => {
                      if (tab.id === 'email' && !emailActive())
                        return toast.failure(
                          'Please enable email in settings first'
                        );

                      setSelectedType(tab.id);
                    }}
                    tabindex={-1}
                  >
                    <Hotkey shortcut={tab.shortcut} />
                    <span>{tab.label}</span>
                  </button>
                )}
              </For>
            </div>
          </div>
        </div>
      </div>
      {/* Content */}
      <div class="flex flex-col gap-2 p-4 pt-3" ref={contentContainerRef}>
        <Switch>
          <Match when={selectedType() === 'note'}>
            <div class="flex w-full h-[38px] shrink-0 bg-input border-2 border-edge overflow-hidden focus-within:bracket">
              <input
                ref={noteTitleRef}
                class="flex size-full text-sm break-words px-2 placeholder:text-ink-placeholder "
                placeholder="New Note"
              />
            </div>
          </Match>

          <Match when={selectedType() === 'email'}>
            <div class="flex w-full focus-within:bracket">
              <RecipientSelector<'user' | 'contact'>
                options={usersAndContacts}
                selectedOptions={selectedEmailOptions}
                setSelectedOptions={setSelectedEmailOptions}
                placeholder="Add recipients by email"
                triedToSubmit={triedToSubmitEmail}
              />
            </div>
          </Match>
          <Match when={selectedType() === 'message'}>
            <div class="flex w-full focus-within:bracket">
              <RecipientSelector<'user' | 'contact' | 'channel'>
                options={destinationOptions}
                selectedOptions={selectedOptions}
                setSelectedOptions={setSelectedOptions}
                placeholder="Add by email or channel"
                triedToSubmit={triedToSubmit}
                triggerMode="input"
              />
            </div>
          </Match>
        </Switch>

        {/* Editor */}
        <div
          class="flex flex-col h-[136px] size-full bg-input border-2 border-edge justify-between overflow-auto p-1 focus-within:bracket"
          onfocusout={() => setIsInteractable(false)}
        >
          <LexicalWrapperContext.Provider value={lexicalWrapper}>
            <div
              class="relative size-full overflow-hidden p-1"
              onClick={focusEditor}
            >
              <div
                class="size-full"
                ref={editorContentRef}
                contentEditable={true}
              />
              <Show when={contentPlaceHolder()}>
                {(placeholder) => (
                  <div class="pointer-events-none absolute top-1">
                    <p class="my-1.5 text-ink-placeholder">{placeholder()}</p>
                  </div>
                )}
              </Show>
              <DecoratorRenderer editor={editor} />
              <NodeAccessoryRenderer editor={editor} store={accessories} />
              <EmojiMenu
                editor={editor}
                menu={emojisMenuOperations}
                portalScope="local"
              />
              <MentionsMenu
                editor={editor}
                menu={mentionsMenuOperations}
                portalScope="local"
                emails={() => []}
              />
              <ActionMenu
                editor={editor}
                menu={actionsMenuOperations}
                portalScope="local"
              />
            </div>
            <TogglingFormatRibbon
              showFormatRibbon={showFormatRibbon()}
              setShowFormatRibbon={setShowFormatRibbon}
            />
          </LexicalWrapperContext.Provider>
        </div>
      </div>

      {/* Footer */}
      <div class="flex justify-between items-center px-4 pb-3">
        <div class="flex items-center gap-2 text-xs text-ink-muted font-mono">
          <Hotkey shortcut="enter" />
          <span>to create</span>
          <span class="text-ink-extra-muted">·</span>
          <Hotkey shortcut="cmd+enter" />
          <span>to create & open</span>
        </div>
        <div class="flex w-32 justify-between font-mono">
          <Dialog.CloseButton as={TextButton} text="Cancel" theme="clear" />
          <TextButton
            text={selectedType() === 'note' ? 'CREATE' : 'SEND'}
            theme="accentFill"
            class="w-18"
            tabIndex={0}
            onClick={() => submit(false)}
          />
        </div>
      </div>
    </div>
  );
}

interface TogglingFormatRibbonProps {
  showFormatRibbon: boolean;
  setShowFormatRibbon: Setter<boolean>;
}
function TogglingFormatRibbon(props: TogglingFormatRibbonProps) {
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const setInlineFormat = (format: TextFormatType): void => {
    lexicalWrapper?.editor.focus();
    lexicalWrapper?.editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
  };
  const setNodeFormat = (transform: NodeTransformType): void => {
    lexicalWrapper?.editor.focus();
    lexicalWrapper?.editor.dispatchCommand(NODE_TRANSFORM, transform);
  };
  return (
    <Show
      when={props.showFormatRibbon && lexicalWrapper?.selection}
      fallback={
        <div class="flex size-fit">
          <Tooltip
            placement="top"
            tooltip={
              <LabelAndHotKey
                label="Format"
                hotkeyToken={TOKENS.global.quickCreate.menuFormat}
              />
            }
          >
            <button
              class="flex flex-col items-center justify-center size-7 hover:bg-hover hover-transition-bg m-2"
              onClick={() => {
                props.setShowFormatRibbon(true);
                if (lexicalWrapper?.isInteractable()) {
                  lexicalWrapper.editor.focus();
                }
              }}
            >
              <FormatIcon width={20} height={20} />
            </button>
          </Tooltip>
        </div>
      }
    >
      {(selectionData) => (
        <div class="flex flex-row w-full gap-2 items-center bg-input p-2">
          <ActionButton
            tooltip="Bold"
            shortcut="meta+b"
            clicked={selectionData().bold}
            onClick={() => setInlineFormat('bold')}
          >
            <TextBold width={20} height={20} />
          </ActionButton>
          <ActionButton
            tooltip="Italic"
            shortcut="meta+i"
            clicked={selectionData().italic}
            onClick={() => setInlineFormat('italic')}
          >
            <TextItalic width={20} height={20} />
          </ActionButton>
          <ActionButton
            tooltip="Strikethrough"
            shortcut="meta+shift+x"
            clicked={selectionData().strikethrough}
            onClick={() => setInlineFormat('strikethrough')}
          >
            <TextStriketrough width={20} height={20} />
          </ActionButton>
          <ActionButton
            tooltip="Code"
            shortcut="meta+e"
            clicked={selectionData().strikethrough}
            onClick={() => setInlineFormat('code')}
          >
            <TextCode width={20} height={20} />
          </ActionButton>
          <div class="w-[1px] h-[20px] bg-edge" />
          <ActionButton
            tooltip="Bullet List"
            clicked={selectionData().elementsInRange.has('list-bullet')}
            onClick={() => setNodeFormat('list-bullet')}
          >
            <ListBullets width={20} height={20} />
          </ActionButton>
          <ActionButton
            tooltip="Numbered List"
            clicked={selectionData().elementsInRange.has('list-number')}
            onClick={() => setNodeFormat('list-number')}
          >
            <ListNumbers width={20} height={20} />
          </ActionButton>
          <ActionButton
            tooltip="Checklist"
            clicked={selectionData().elementsInRange.has('list-check')}
            onClick={() => setNodeFormat('list-check')}
          >
            <ListChecks width={20} height={20} />
          </ActionButton>
        </div>
      )}
    </Show>
  );
}

interface ActionButtonProps {
  onClick: (e: MouseEvent) => void;
  tooltip: string;
  shortcut?: string;
  clicked?: boolean;
}
function ActionButton(props: ParentProps<ActionButtonProps>) {
  return (
    <Tooltip
      placement="top"
      floatingOptions={{ offset: 12 }}
      tooltip={
        <LabelAndHotKey label={props.tooltip} shortcut={props.shortcut} />
      }
    >
      <button
        class={`flex flex-col items-center justify-center h-[28px] w-[28px] hover:bg-hover hover-transition-bg `}
        onClick={props.onClick}
      >
        {props.children}
      </button>
    </Tooltip>
  );
}

type UseQuickCreateMenu = {
  QuickCreateMenu: () => JSXElement;
  openMenuWithType: (type: CreateType) => void;
  quickCreateMenuOpen: Accessor<boolean>;
  setQuickCreateMenuOpen: Setter<boolean>;
  closeMenu: () => void;
  openMenu: () => void;
};

export function useQuickCreateMenu(): UseQuickCreateMenu {
  const selectedTypeSignal = createSignal<CreateType>('note');
  const quickCreateMenuOpenSignal = createSignal(false);
  const setSelectedType = selectedTypeSignal[1];
  const [quickCreateMenuOpen, setQuickCreateMenuOpen] =
    quickCreateMenuOpenSignal;

  const openMenuWithType = (type: CreateType) => {
    setSelectedType(type);
    setQuickCreateMenuOpen(true);
  };

  const closeMenu = () => {
    setQuickCreateMenuOpen(false);
  };

  const openMenu = () => {
    setQuickCreateMenuOpen(true);
  };

  return {
    QuickCreateMenu: () => <QuickCreateMenu />,
    quickCreateMenuOpen: quickCreateMenuOpen,
    setQuickCreateMenuOpen: setQuickCreateMenuOpen,
    openMenuWithType,
    closeMenu,
    openMenu,
  };
}
