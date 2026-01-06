import { FormatRibbon } from '@block-channel/component/FormatRibbon';
import { MacroSignatureButton } from '@block-email/component/MacroSignatureButton';
import { MACRO_EMAIL_SIGNATURE } from '@block-email/constants';
import { useHasPaidAccess } from '@core/auth';
import { useBlockId } from '@core/block';
import { BrightJoins } from '@core/component/BrightJoins';
import { FileDropOverlay } from '@core/component/FileDropOverlay';
import { MarkdownTextarea } from '@core/component/LexicalMarkdown/component/core/MarkdownTextarea';
import type { UserMentionRecord } from '@core/component/LexicalMarkdown/component/menu/MentionsMenu';
import { DropdownMenuContent, MenuItem } from '@core/component/Menu';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { toast } from '@core/component/Toast/Toast';
import { Tooltip } from '@core/component/Tooltip';
import { fileDrop } from '@core/directive/fileDrop';
import { TOKENS } from '@core/hotkey/tokens';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import { trackMention } from '@core/signal/mention';
import { useDisplayName } from '@core/user';
import ArrowUp from '@icon/bold/arrow-up-bold.svg';
import Spinner from '@icon/bold/spinner-gap-bold.svg';
import ReplyAll from '@icon/regular/arrow-bend-double-up-left.svg';
import Reply from '@icon/regular/arrow-bend-up-left.svg';
import Forward from '@icon/regular/arrow-bend-up-right.svg';
import Plus from '@icon/regular/plus.svg';
import Quotes from '@icon/regular/quotes.svg';
import TextAa from '@icon/regular/text-aa.svg';
import Trash from '@icon/regular/trash.svg';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { ToggleButton as KToggleButton } from '@kobalte/core/toggle-button';
import {
  $appendWatermarkNodeToLast,
  $removeAllWatermarkNodes,
  type DocumentMentionInfo,
} from '@lexical-core';
import { logger } from '@observability';
import { useEmailLinksQuery } from '@queries/email/link';
import { useSendMessageMutation } from '@queries/email/thread';
import type {
  AttachmentMacro,
  MessageToSend,
  MessageToSendDbId,
  MessageWithBodyReplyless,
} from '@service-email/generated/schemas';
import { useEmail, useUserId } from '@service-gql/client';
import type { FileType } from '@service-storage/generated/schemas/fileType';
import type { Item } from '@service-storage/generated/schemas/item';
import { Button } from '@ui/components/Button';
import {
  defaultSelectionData,
  lazyRegister,
  type SelectionData,
} from 'core/component/LexicalMarkdown/plugins';
import {
  NODE_TRANSFORM,
  type NodeTransformType,
} from 'core/component/LexicalMarkdown/plugins/node-transform/nodeTransformPlugin';
import { registerHotkey, useHotkeyDOMScope } from 'core/hotkey/hotkeys';
import {
  $getRoot,
  FORMAT_TEXT_COMMAND,
  type LexicalEditor,
  type TextFormatType,
} from 'lexical';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  type Setter,
  Show,
  untrack,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { deleteEmailDraft, saveEmailDraft } from '../signal/emailDraft';
import { handleFileUpload } from '../util/handleFileUpload';
import { makeAttachmentPublic } from '../util/makeAttachmentPublic';
import { getFirstName } from '../util/name';
import {
  appendItemsAsMacroMentions,
  clearEmailBody,
  prepareEmailBody,
  prepareMacroBody,
  registerToggleAppendedThread,
  TOGGLE_APPEND_EMAIL_THREAD_COMMAND,
} from '../util/prepareEmailBody';
import { convertEmailRecipientToContactInfo } from '../util/recipientConversion';
import { getReplyTypeFromDraft } from '../util/replyType';
import { AttachMenu } from './AttachMenu';
import { type EmailRecipient, useEmailContext } from './EmailContext';
import { getOrInitEmailFormContext } from './EmailFormContext';

false && fileDrop;

const getRecipientDisplayName = (item: EmailRecipient): string => {
  switch (item.kind) {
    case 'user':
    case 'contact':
      return getFirstName(item.data.name) || item.data.email;
    case 'custom':
      return item.data.email;
  }
};

function RecipientList(props: {
  recipients: EmailRecipient[];
  showTrailingComma: boolean;
}) {
  return (
    <For each={props.recipients}>
      {(recipient, index) => (
        <Tooltip
          tooltip={
            <div class="text-xs select-text cursor-text">
              {recipient.data.email}
            </div>
          }
          class="inline"
        >
          <span>
            {getRecipientDisplayName(recipient) +
              (index() < props.recipients.length - 1 || props.showTrailingComma
                ? ', '
                : '')}
            &emsp;
          </span>
        </Tooltip>
      )}
    </For>
  );
}

export function BaseInput(props: {
  replyingTo: Accessor<MessageWithBodyReplyless>;
  newMessage?: boolean;
  draft?: MessageWithBodyReplyless;
  preloadedBody?: string;
  preloadedHtml?: string;
  preloadedAttachments?: AttachmentMacro[];
  sideEffectOnSend?: (newMessageId: MessageToSendDbId | null) => void;
  onMarkDone?: () => void;
  setShowReply?: Setter<boolean>;
  markdownDomRef?: (ref: HTMLDivElement) => void | HTMLDivElement;
}) {
  const ctx = useEmailContext();
  const form = createMemo(() =>
    getOrInitEmailFormContext(props.replyingTo().db_id!)()
  );
  const blockId = useBlockId();
  const emailLinksQuery = useEmailLinksQuery();

  const [bodyMacro, setBodyMacro] = createSignal<string>('');
  const [expandedRecipientsRef, setExpandedRecipientsRef] =
    createSignal<HTMLDivElement>();
  const [editor, setEditor] = createSignal<LexicalEditor>();
  const [showSubject, _] = createSignal(props.newMessage ?? false);
  const [attachMenuOpen, setAttachMenuOpen] = createSignal(false);
  const [showExpandedRecipients, setShowExpandedRecipients] =
    createSignal<boolean>(false);
  const [isDragging, setIsDragging] = createSignal<boolean>();
  const [isPendingUpload, setIsPendingUpload] = createSignal<boolean>(false);
  const [showFormatRibbon, setShowFormatRibbon] = createSignal<boolean>(
    props.newMessage ?? false
  );
  const [formatState, setFormatState] = createStore<SelectionData>(
    structuredClone(defaultSelectionData)
  );
  const [toRef, setToRef] = createSignal<HTMLInputElement>();
  const [ccRef, setCcRef] = createSignal<HTMLInputElement>();
  const [bccRef, setBccRef] = createSignal<HTMLInputElement>();
  const [showCc, setShowCc] = createSignal<boolean>();
  const [showBcc, setShowBcc] = createSignal<boolean>();
  const [savedDraftId, setSavedDraftId] = createSignal<
    MessageToSendDbId | undefined
  >(props.draft?.db_id ?? undefined);

  let pendingMentions: { documentId: string }[] = [];
  const [shouldMarkDoneOnSuccess, setShouldMarkDoneOnSuccess] =
    createSignal(false);

  const sendMutation = useSendMessageMutation({
    onSuccess: async ({ message }) => {
      toast.success('Email sent');
      pendingMentions.forEach((mention) => {
        trackMention(blockId, 'document', mention.documentId);
      });
      pendingMentions = [];
      await deleteDraftAndReset();
      refetchThreadMessages();
      props.sideEffectOnSend?.(message.db_id ?? null);
      if (shouldMarkDoneOnSuccess()) {
        props.onMarkDone?.();
        setShouldMarkDoneOnSuccess(false);
      }
    },
    onError: () => {
      toast.failure('Failed to send email');
    },
  });

  function refetchThreadMessages() {
    ctx.query.refetch();
  }

  // Attach side-effect handlers on mount; they replay against current state
  onMount(() => {
    form().setOnDirty(() => {
      scheduleDraftSave();
    });

    form().setOnReplyTypeApplied((rt) => {
      if (rt === 'forward') {
        setShowExpandedRecipients(true);
        setTimeout(() => {
          if (toRef()) {
            toRef()?.focus();
          }
        }, 100);
      }
    });
  });

  const effectiveReplyType = createMemo(() => {
    return (
      form().replyType() ??
      getReplyTypeFromDraft(props.draft) ??
      ((props.replyingTo()?.to.length ?? 0) +
        (props.replyingTo()?.cc.length ?? 0) >
      1
        ? 'reply-all'
        : 'reply')
    );
  });

  lazyRegister(editor, (editor) => {
    return registerToggleAppendedThread(editor);
  });

  const userEmail = useEmail();
  const userId = useUserId();
  const [userName] = useDisplayName(userId());

  let bodyDiv!: HTMLDivElement;
  let attachButtonRef!: HTMLDivElement;
  let draftSaveTimer: number | undefined;
  const DRAFT_DEBOUNCE_MS = 1000;

  function collectDraft(): Omit<MessageToSend, 'link_id'> | null {
    $removeAllWatermarkNodes(editor());
    const prepared = prepareEmailBody(editor());
    if (!prepared) {
      logger.error(
        new Error('Unable to prepare email body for draft collection.')
      );
      return null;
    }
    // Fail if no body text
    if (prepared.bodyText.trim() === '') {
      return null;
    }
    // We attach the drafts entirely using bodyHTML (because this is how the appended reply parsing works) so we are not including bodyMacro or bodyText
    return {
      bcc: form().recipients.bcc.map(convertEmailRecipientToContactInfo),
      body_html: prepared.bodyHtml,
      cc: form().recipients.cc.map(convertEmailRecipientToContactInfo),
      // db_id: props.draft ? props.draft?.db_id : undefined,
      provider_id: props.draft?.provider_id,
      replying_to_id: props.replyingTo()?.db_id,
      subject: form().subject(),
      to: form().recipients.to.map(convertEmailRecipientToContactInfo),
    };
  }

  async function executeSaveDraft() {
    if (sendMutation.isPending) {
      return;
    }
    const draftToSave = collectDraft();
    if (!draftToSave) {
      const draftId = savedDraftId();
      if (draftId) {
        await deleteEmailDraft(draftId);
        refetchThreadMessages();
      }
      setSavedDraftId(undefined);
      return;
    }
    const currentThread = ctx.thread();
    const newMessage = props.newMessage ?? false;

    if (!currentThread && !newMessage) {
      logger.error(new Error('Failed to save draft: thread not found'));
      return false;
    }

    if (newMessage && currentThread) {
      logger.error(
        new Error(
          'Failed to save draft: new message and current thread cannot be provided together'
        )
      );
      return false;
    }

    let linkId: string | undefined = currentThread?.link_id;
    if (newMessage || !linkId) {
      if (emailLinksQuery.isPending) {
        return false;
      }

      if (emailLinksQuery.isError) {
        logger.error(
          new Error('Failed to save email draft: could not load email links')
        );
        return false;
      }

      const linksData = emailLinksQuery.data;
      if (!linksData || linksData.links.length === 0) {
        logger.error(new Error('Failed to save email draft: no links found'));
        return false;
      }
      linkId = linksData.links[0].id;
    }

    const draftResponse = await saveEmailDraft({
      ...draftToSave,
      link_id: linkId!,
      provider_thread_id: currentThread?.provider_id,
      thread_db_id: currentThread?.db_id,
    });
    if (draftResponse) {
      setSavedDraftId(draftResponse);
    }
    refetchThreadMessages();
  }

  function scheduleDraftSave() {
    if (draftSaveTimer) window.clearTimeout(draftSaveTimer);
    draftSaveTimer = window.setTimeout(() => {
      void executeSaveDraft();
    }, DRAFT_DEBOUNCE_MS);
  }

  // We are consuming the first change, because it is the initial value
  let firstChangeConsumed = false;
  const handleChange = (value: string) => {
    setBodyMacro(value);
    if (!firstChangeConsumed) {
      firstChangeConsumed = true;
      return;
    }
    untrack(scheduleDraftSave);
  };

  function onAttach(items: Item[]) {
    const documentMentionItems = items.map((item) => ({
      documentId: item.id,
      documentName: item.name,
      blockName:
        item.type === 'document' ? (item.fileType as FileType) : item.type,
    }));
    appendItemsAsMacroMentions(editor(), documentMentionItems);
    items.forEach((item) => {
      makeAttachmentPublic(item.id);
    });
    scheduleDraftSave();
  }

  function onAttachDocuments(items: DocumentMentionInfo[]) {
    appendItemsAsMacroMentions(editor(), items);
    items.forEach((item) => {
      makeAttachmentPublic(item.documentId);
    });
    scheduleDraftSave();
  }

  // Handles clicks outside of the expanded recipients area
  const expandedPointerDownHandler = (e: PointerEvent) => {
    if (showExpandedRecipients()) {
      const combobox = document.querySelector('div[data-popper-positioner]');
      if (
        !expandedRecipientsRef()?.contains(e.target as Node) &&
        !combobox?.contains(e.target as Node)
      ) {
        setShowExpandedRecipients(false);
        setShowCc(form().recipients.cc.length > 0);
        setShowBcc(form().recipients.bcc.length > 0);
      }
    }
  };

  onMount(() => {
    document.addEventListener('pointerdown', expandedPointerDownHandler);

    onCleanup(() => {
      document.removeEventListener('pointerdown', expandedPointerDownHandler);
    });
  });

  const hasPaidAccess = useHasPaidAccess();

  // Set up hotkey scope for the compose message component
  const [attachComposeHotkeys, composeHotkeyScope] =
    useHotkeyDOMScope('compose-message');
  let composeContainerRef: HTMLDivElement | undefined;

  const sendEmail = async (markDone = false) => {
    if (sendMutation.isPending || isPendingUpload()) return;

    const to = form().recipients.to.map(convertEmailRecipientToContactInfo);
    const cc = form().recipients.cc.map(convertEmailRecipientToContactInfo);
    const bcc = form().recipients.bcc.map(convertEmailRecipientToContactInfo);

    if ((to?.length ?? 0) + (cc?.length ?? 0) + (bcc?.length ?? 0) === 0) {
      toast.failure('Email failed to send. No recipients provided');
      return;
    }

    const currentThread = ctx.thread();
    const newMessage = props.newMessage ?? false;

    if (!currentThread && !newMessage) {
      logger.error(new Error("Can't send email, no email thread found"));
      toast.failure('Email failed to send');
      return;
    }

    if (newMessage && currentThread) {
      toast.failure('Email failed to send');
      logger.error('New message and thread cannot be provided together');
      return;
    }

    let linkId: string | undefined = currentThread?.link_id;
    if (newMessage || !linkId) {
      if (emailLinksQuery.isPending) {
        toast.alert('Loading email accounts...');
        return;
      }

      if (emailLinksQuery.isError) {
        toast.failure('Email failed to send: Could not load email accounts');
        logger.error('Failed to load email links');
        return;
      }

      const linksData = emailLinksQuery.data;
      if (!linksData || linksData.links.length < 1) {
        toast.failure('Email failed to send: No email account connected');
        logger.error('No links found');
        return;
      }
      linkId = linksData.links[0].id;
    }

    const currentEditor = editor();

    // We handle cleaning up the signature after we've sent the request because
    // otherwise the `bodyMacro` signal would update after the clean up call and
    // not contain the signature in the request data
    const cleanupWatermark = $appendWatermarkNodeToLast(
      currentEditor,
      !hasPaidAccess() ? MACRO_EMAIL_SIGNATURE : undefined
    );

    const prepared = prepareEmailBody(currentEditor, {
      replyType: effectiveReplyType(),
      replyingTo: props.replyingTo(),
    });
    if (!prepared) {
      return;
    }

    pendingMentions = prepared.mentions;
    setShouldMarkDoneOnSuccess(markDone);

    const processedMacroBody = prepareMacroBody(bodyMacro());

    sendMutation.mutate({
      message: {
        bcc,
        body_html: prepared.bodyHtml,
        body_macro: processedMacroBody,
        body_text: prepared.bodyText,
        cc,
        provider_id: props.draft?.provider_id,
        provider_thread_id: currentThread?.provider_id,
        replying_to_id: props.replyingTo()?.db_id,
        subject: form().subject(),
        thread_db_id: currentThread?.db_id,
        to,
        link_id: linkId!,
      },
    });

    cleanupWatermark();
  };

  const resetState = () => {
    clearEmailBody(editor());
    setBodyMacro('');
    setSavedDraftId(undefined);
    form().reset();
  };

  const deleteDraftAndReset = async () => {
    const draftId = savedDraftId();
    if (draftId) {
      await deleteEmailDraft(draftId);
      refetchThreadMessages();
    }
    const replyingToId = props.replyingTo()?.db_id;
    if (replyingToId) {
      ctx.drafts.deleteDraftForMessage(replyingToId);
    }
    resetState();
    props.setShowReply?.(false);
  };

  const handleUserMention = (mention: UserMentionRecord) => {
    // Extract the email from the mention argument
    const mentionEmail = mention.mentions[0].split('|')[1];

    // Check if user already in To or CC
    const isInTo = form().recipients.to.some((recipient: EmailRecipient) => {
      const email = recipient.data.email;
      if (!email) return false;
      return email === mentionEmail;
    });

    const isInCc = form().recipients.cc.some((recipient: EmailRecipient) => {
      const email = recipient.data.email;
      if (!email) return false;
      return email === mentionEmail;
    });

    // If not already in To or CC, add user to CC
    if (!isInTo && !isInCc) {
      // Find the user in recipient options
      const userOption = ctx.recipientOptions().find((recipient) => {
        const email = recipient.data.email;
        if (!email) return false;
        return email === mentionEmail;
      });

      if (userOption) {
        // Add to CC recipients
        form().setRecipients('cc', (prev: EmailRecipient[]) => [
          ...(prev ?? []),
          userOption,
        ]);
        toast.success(`${mentionEmail} added to CC`);
      }
    }
  };

  onMount(() => {
    if (composeContainerRef) {
      attachComposeHotkeys(composeContainerRef);

      registerHotkey({
        hotkey: 'cmd+enter',
        scopeId: composeHotkeyScope,
        description: 'Send email',
        keyDownHandler: () => {
          sendEmail();
          return true;
        },
        runWithInputFocused: true,
        hotkeyToken: TOKENS.email.send,
        displayPriority: 9,
      });

      registerHotkey({
        hotkey: 'shift+cmd+enter',
        scopeId: composeHotkeyScope,
        description: 'Send and mark done',
        keyDownHandler: () => {
          sendEmail(true);
          return true;
        },
        runWithInputFocused: true,
        hotkeyToken: TOKENS.email.sendAndMarkDone,
        displayPriority: 10,
      });
    }
  });

  // Focus when external shouldFocus signal is set to true
  createEffect(() => {
    if (form().shouldFocusInput()) {
      if (!isMobileWidth()) {
        requestAnimationFrame(() => {
          editor()?.focus();
          form().setShouldFocusInput(false);
        });
      } else {
        form().setShouldFocusInput(false);
      }
    }
  });

  const ReplyIcon = createMemo(() => {
    let Icon =
      effectiveReplyType() === 'reply'
        ? Reply
        : effectiveReplyType() === 'reply-all'
          ? ReplyAll
          : Forward;

    return (
      <Button showChevron>
        <Icon class="h-7 p-1" />
      </Button>
    );
  });

  return (
    <div
      ref={(el) => {
        composeContainerRef = el;
      }}
      class="relative flex flex-col flex-1 bg-input border-t border-x border-edge-muted rounded-t-[5px] -mb-[7px] max-w-full"
    >
      <BrightJoins dots={[false, false, true, true]} />
      {/* Top Bar */}
      <div class="flex items-start gap-2 p-2">
        <DropdownMenu>
          <DropdownMenu.Trigger>
            <div class="px-1">{ReplyIcon()}</div>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenuContent>
              <MenuItem
                icon={Reply}
                text="Reply"
                onClick={() => form().setReplyType('reply')}
              />
              <Show
                when={
                  (props.replyingTo()?.to.length ?? 0) +
                    (props.replyingTo()?.cc.length ?? 0) >
                  1
                }
              >
                <MenuItem
                  icon={ReplyAll}
                  text="Reply All"
                  onClick={() => form().setReplyType('reply-all')}
                />
              </Show>
              <MenuItem
                icon={Forward}
                text="Forward"
                onClick={() => form().setReplyType('forward')}
              />
            </DropdownMenuContent>
          </DropdownMenu.Portal>
        </DropdownMenu>
        <Show
          when={showExpandedRecipients()}
          fallback={
            <div
              class="flex flex-wrap items-center text-sm font-mono truncate overflow-hidden mt-1"
              onclick={() => setShowExpandedRecipients(true)}
            >
              <Show
                when={
                  form().recipients.to.length +
                    form().recipients.cc.length +
                    form().recipients.bcc.length >
                  0
                }
                fallback={
                  <span class="text-failure-ink">Recipients required</span>
                }
              >
                <Show
                  when={
                    form().recipients.to.length + form().recipients.cc.length >
                    0
                  }
                >
                  <span>to&nbsp;</span>
                </Show>
                <RecipientList
                  recipients={form().recipients.to}
                  showTrailingComma={form().recipients.cc.length > 0}
                />
                <RecipientList
                  recipients={form().recipients.cc}
                  showTrailingComma={false}
                />
                <Show when={form().recipients.bcc.length > 0}>, bcc: </Show>
                <RecipientList
                  recipients={form().recipients.bcc}
                  showTrailingComma={false}
                />
              </Show>
            </div>
          }
        >
          <div ref={setExpandedRecipientsRef} class="w-full">
            {/* Expanded FROM */}
            <div class="flex flex-row items-baseline font-mono">
              <span class="text-sm text-ink-muted min-w-8">
                from <span>{userName()} </span>
                <span>&lt;{userEmail()}&gt;</span>
              </span>
            </div>
            {/* Expanded TO */}

            <div class="flex flex-row items-baseline">
              <div class="text-sm text-ink-muted min-w-8">to</div>
              <RecipientSelector<EmailRecipient['kind']>
                inputRef={setToRef}
                options={ctx.recipientOptions}
                selectedOptions={() => form().recipients.to}
                setSelectedOptions={(v) => form().setRecipients('to', v)}
                triggerMode="input"
                hideBorder
              />
            </div>
            {/* Expanded CC */}
            <Show when={showCc() || form().recipients.cc.length > 0}>
              <div class="flex flex-row items-start">
                <div class="text-sm text-ink-muted min-w-8">cc</div>
                <RecipientSelector<EmailRecipient['kind']>
                  inputRef={setCcRef}
                  options={ctx.recipientOptions}
                  selectedOptions={() => form().recipients.cc}
                  setSelectedOptions={(v) => form().setRecipients('cc', v)}
                  triggerMode="input"
                  hideBorder
                />
              </div>
            </Show>
            {/* Expanded BCC */}
            <Show when={showBcc() || form().recipients.bcc.length > 0}>
              <div class="flex flex-row items-start">
                <div class="text-sm text-ink-muted min-w-8">bcc</div>
                <RecipientSelector<EmailRecipient['kind']>
                  inputRef={setBccRef}
                  options={ctx.recipientOptions}
                  selectedOptions={() => form().recipients.bcc}
                  setSelectedOptions={(v) => form().setRecipients('bcc', v)}
                  triggerMode="input"
                  hideBorder
                />
              </div>
            </Show>
            {/* Show to, cc, bcc buttons */}
            <div class="flex flex-row justify-end space-x-2 pt-2">
              <Show when={!showCc()}>
                <Tooltip tooltip="Add cc recipients">
                  <div
                    onclick={() => {
                      setShowCc(true);
                      ccRef()?.focus();
                    }}
                    class="text-xs hover:underline"
                  >
                    cc
                  </div>
                </Tooltip>
              </Show>
              <Show when={!showBcc()}>
                <Tooltip tooltip="Add bcc recipients">
                  <div
                    onclick={() => {
                      setShowBcc(true);
                      bccRef()?.focus();
                    }}
                    class="text-xs hover:underline"
                  >
                    bcc
                  </div>
                </Tooltip>
              </Show>
            </div>
          </div>
        </Show>
      </div>
      <div class={`${showSubject() ? 'flex' : 'hidden'} flex-row items-center`}>
        <div class="text-xs min-w-16">Subject</div>
        <input
          type="text"
          class="flex-1 text-sm bg-transparent outline-none border-0 px-3 py-1"
          value={form().subject()}
          onInput={(e) => {
            form().setSubject(e.currentTarget.value);
          }}
          placeholder="Subject"
        />
      </div>
      <div class="w-full h-full flex flex-col">
        <Show when={showFormatRibbon()}>
          <FormatRibbon
            state={formatState}
            inlineFormat={(format: TextFormatType) => {
              editor()?.dispatchCommand(FORMAT_TEXT_COMMAND, format);
            }}
            nodeFormat={(transform: NodeTransformType) => {
              editor()?.dispatchCommand(NODE_TRANSFORM, transform);
            }}
          />
        </Show>
        <div
          class="max-h-80 overflow-y-scroll w-full flex flex-col cursor-text placeholder:text-ink-placeholder placeholder:opacity-50 px-3"
          ref={bodyDiv}
          onclick={() => {
            editor()?.focus();
          }}
          use:fileDrop={{
            onDragStart: () => setIsDragging(true),
            onDragEnd: () => setIsDragging(false),
            onDrop: async (files) => {
              handleFileUpload(files, setIsPendingUpload, (items) => {
                setIsDragging(false);
                appendItemsAsMacroMentions(editor(), items);
                items.forEach((item) => {
                  makeAttachmentPublic(item.documentId);
                });
                scheduleDraftSave();
              });
            },
          }}
        >
          <div
            class={`${!isDragging() && 'hidden'} absolute size-full inset-0`}
          >
            <FileDropOverlay>Drop file(s) to attach</FileDropOverlay>
          </div>
          <MarkdownTextarea
            captureEditor={(editor) => {
              setEditor(editor);
              form().setCapturedEditor(editor);
            }}
            class={`text-sm break-words text-ink ${isDragging() && 'blur'}`}
            editable={() => !sendMutation.isPending}
            initialValue={props.preloadedBody}
            initialHtml={props.preloadedHtml}
            placeholder="Reply — @mention to share or cc people"
            watermark={!hasPaidAccess() ? <MacroSignatureButton /> : undefined}
            onChange={handleChange}
            onDocumentMention={(item) => {
              makeAttachmentPublic(item.id);
            }}
            onUserMention={handleUserMention}
            portalScope="local"
            formatState={formatState}
            setFormatState={setFormatState}
            domRef={props.markdownDomRef}
          />
        </div>
        <div class="flex flex-row w-full h-8 justify-between items-center py-2 px-2 mb-2 space-x-2 allow-css-brackets">
          <div class="flex flex-row items-center gap-2">
            <div class="relative" ref={attachButtonRef}>
              <Button
                onclick={() => setAttachMenuOpen(true)}
                tooltip="Attach"
                class="aspect-square *:h-5 p-1"
              >
                <Plus />
              </Button>

              <AttachMenu
                open={attachMenuOpen()}
                close={() => setAttachMenuOpen(false)}
                anchorRef={attachButtonRef}
                containerRef={bodyDiv}
                onAttach={onAttach}
                onAttachDocuments={onAttachDocuments}
                setIsPending={setIsPendingUpload}
              />
            </div>

            <Button
              onclick={() => {
                setShowFormatRibbon(!showFormatRibbon());
              }}
              tooltip="Show formatting toolbar"
              class="aspect-square *:h-5 p-1"
            >
              <TextAa />
            </Button>

            <Tooltip
              tooltip={
                form().replyAppended() ? 'Hide quoted text' : 'Show quoted text'
              }
            >
              <KToggleButton
                class={
                  'w-fit disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none [&:focus]:disabled:[--focus-border-inset:0] [&:focus]:[--focus-border-inset:-3px] group'
                }
                pressed={form().replyAppended()}
                onChange={() => {
                  const replyingToID = props.replyingTo()?.replying_to_id;
                  if (!replyingToID) return;

                  const currentlyAppended = form().replyAppended();
                  form().setReplyAppended(!currentlyAppended);

                  editor()?.dispatchCommand(
                    TOGGLE_APPEND_EMAIL_THREAD_COMMAND,
                    {
                      replyingTo: props.replyingTo(),
                      replyType: effectiveReplyType(),
                      visible: !currentlyAppended,
                    }
                  );

                  editor()?.update(() => {
                    $getRoot().getFirstChild()?.selectStart();
                  });
                }}
              >
                <div class="min-w-[22px] text-xs font-medium font-mono text-ink-muted text-center uppercase leading-none whitespace-nowrap group-data-[pressed]:bg-accent/10 group-data-[pressed]:hover:bg-accent/20 group-data-[pressed='false']:hover:text-ink hover:bg-edge-muted hover-transition-bg group-data-[pressed]:text-accent-ink p-1">
                  <Quotes class="inline size-4" />
                </div>
              </KToggleButton>
            </Tooltip>
            <Show when={savedDraftId()}>
              <Button
                onclick={deleteDraftAndReset}
                tooltip="Delete draft"
                class="aspect-square *:h-5 p-1"
              >
                <Trash />
              </Button>
            </Show>
          </div>

          <Button
            disabled={isPendingUpload() || sendMutation.isPending}
            onClick={() => sendEmail()}
            class="text-ink-muted hover:scale-115 transition ease-in-out flex-col items-center rounded-full p-[0.25lh] hover:bg-transparent"
          >
            <Show
              when={!isPendingUpload() && !sendMutation.isPending}
              fallback={<Spinner class="size-6 animate-spin cursor-disabled" />}
            >
              <div class="group hover:bg-accent transition ease-in-out size-6 border border-accent rounded-full flex items-center justify-center p-0">
                <ArrowUp class="group-hover:!text-input group-hover:!fill-input !text-accent-ink !fill-accent size-4 transition ease-in-out" />
              </div>
            </Show>
          </Button>
        </div>
      </div>
    </div>
  );
}
