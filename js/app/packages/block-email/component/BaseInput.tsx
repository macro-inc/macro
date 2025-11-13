import { FormatRibbon } from '@block-channel/component/FormatRibbon';
import { useBlockId } from '@core/block';
import { FileDropOverlay } from '@core/component/FileDropOverlay';
import { IconButton } from '@core/component/IconButton';
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
import { isErr, isOk } from '@core/util/maybeResult';
import PaperPlaneRight from '@icon/fill/paper-plane-right-fill.svg';
import ReplyAll from '@icon/regular/arrow-bend-double-up-left.svg';
import Reply from '@icon/regular/arrow-bend-up-left.svg';
import Forward from '@icon/regular/arrow-bend-up-right.svg';
import DotsThree from '@icon/regular/dots-three.svg';
import Plus from '@icon/regular/plus.svg';
import TextAa from '@icon/regular/text-aa.svg';
import Trash from '@icon/regular/trash.svg';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import type { DocumentMentionInfo } from '@lexical-core';
import { logger } from '@observability';
import Spinner from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
import { emailClient } from '@service-email/client';
import type {
  AttachmentMacro,
  MessageToSend,
  MessageToSendDbId,
  MessageWithBodyReplyless,
} from '@service-email/generated/schemas';
import { useEmail, useUserId } from '@service-gql/client';
import type { FileType } from '@service-storage/generated/schemas/fileType';
import type { Item } from '@service-storage/generated/schemas/item';
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
import { createStore, produce } from 'solid-js/store';
import { deleteEmailDraft, saveEmailDraft } from '../signal/emailDraft';
import { handleFileUpload } from '../util/handleFileUpload';
import { makeAttachmentPublic } from '../util/makeAttachmentPublic';
import { getFirstName } from '../util/name';
import {
  APPEND_PREVIOUS_EMAIL_COMMAND,
  appendItemsAsMacroMentions,
  clearEmailBody,
  prepareEmailBody,
  registerAppendPreviousEmail,
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
  draftContainsAppendedReply?: boolean;
  preloadedAttachments?: AttachmentMacro[];
  sideEffectOnSend?: (newMessageId: MessageToSendDbId | null) => void;
  setShowReply?: Setter<boolean>;
  markdownDomRef?: (ref: HTMLDivElement) => void | HTMLDivElement;
}) {
  const ctx = useEmailContext();
  const form = createMemo(() =>
    getOrInitEmailFormContext(props.replyingTo().db_id!)()
  );
  const blockId = useBlockId();

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
  const [isPendingSend, setIsPendingSend] = createSignal<boolean>(false);
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

  const [replyAppended, setReplyAppended] = createSignal<boolean>(
    props.draftContainsAppendedReply ?? false
  );

  const [savedDraftId, setSavedDraftId] = createSignal<
    MessageToSendDbId | undefined
  >(props.draft?.db_id ?? undefined);

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
    return registerAppendPreviousEmail(editor);
  });

  const userEmail = useEmail();
  const userId = useUserId();
  const [userName] = useDisplayName(userId());

  let bodyDiv!: HTMLDivElement;
  let attachButtonRef!: HTMLDivElement;
  let draftSaveTimer: number | undefined;
  const DRAFT_DEBOUNCE_MS = 1000;

  function collectDraft(): Omit<MessageToSend, 'link_id'> | null {
    const prepared = prepareEmailBody(editor());
    if (!prepared) {
      logger.error(
        new Error('Unable to prepare email body for draft collection.')
      );
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
    if (bodyMacro().trim().length === 0 || isPendingSend()) {
      return;
    }
    const draftToSave = collectDraft();
    if (!draftToSave) {
      // If there's no content, we should delete the draft
      // TODO this endpoint does not exist.
      return logger.error(
        new Error('Unable to collect email draft for saving.')
      );
    }
    const currentThread = ctx.threadData();
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
      const maybeFallbackLinks = await emailClient.getLinks();
      if (
        isErr(maybeFallbackLinks) ||
        maybeFallbackLinks[1].links.length === 0
      ) {
        logger.error(new Error('Failed to save email draft: no links found'));
        return false;
      }
      linkId = maybeFallbackLinks[1].links[0].id;
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

  // Set up hotkey scope for the compose message component
  const [attachComposeHotkeys, composeHotkeyScope] =
    useHotkeyDOMScope('compose-message');
  let composeContainerRef: HTMLDivElement | undefined;

  const sendEmail = async () => {
    if (isPendingSend() || isPendingUpload() || bodyMacro().trim().length === 0)
      return;
    setIsPendingSend(true);
    const to = form().recipients.to.map(convertEmailRecipientToContactInfo);
    const cc = form().recipients.cc.map(convertEmailRecipientToContactInfo);
    const bcc = form().recipients.bcc.map(convertEmailRecipientToContactInfo);

    if ((to?.length ?? 0) + (cc?.length ?? 0) + (bcc?.length ?? 0) === 0) {
      toast.failure('Email failed to send. No recipients provided');
      return;
    }

    const currentThread = ctx.threadData();
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
      const maybeFallbackLinks = await emailClient.getLinks();
      if (isErr(maybeFallbackLinks) || maybeFallbackLinks[1].links.length < 1) {
        toast.failure('Email failed to send');
        logger.error('No links found');
        return;
      }
      linkId = maybeFallbackLinks[1].links[0].id;
    }

    const prepared = prepareEmailBody(editor(), {
      replyType: effectiveReplyType(),
      replyingTo: props.replyingTo(),
    });
    if (!prepared) return;

    const response = await emailClient.sendMessage({
      message: {
        bcc,
        body_html: prepared.bodyHtml,
        body_macro: bodyMacro(),
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
    if (isOk(response)) {
      toast.success('Email sent');
      const [, { message }] = response;
      prepared.mentions.forEach((mention) => {
        trackMention(blockId, 'document', mention.documentId);
      });
      clearEmailBody(editor());
      resetState();
      if (props.sideEffectOnSend) {
        props.sideEffectOnSend(message.db_id ?? null);
      }
    } else {
      toast.failure('Failed to send email');
    }

    setIsPendingSend(false);
  };

  const resetState = () => {
    setBodyMacro('');
    setReplyAppended(props.draftContainsAppendedReply ?? false);
    setSavedDraftId(undefined);

    form().reset();
  };

  const handleDeleteDraft = () => {
    const draftId = savedDraftId();
    if (!draftId) {
      return console.error('No draft to delete');
    }
    deleteEmailDraft(draftId).then((success) => {
      if (success) {
        if (props.replyingTo()?.db_id) {
          ctx.setMessageDbIdToDraftChildren(
            produce((state) => {
              // @ts-expect-error - we know the draft id is valid, but TS doesn't (why?)
              delete state[props.replyingTo.db_id];
            })
          );
        }
        clearEmailBody(editor());
        resetState();
        props.setShowReply?.(false);
      } else {
        toast.failure('Failed to delete draft');
      }
    });
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
    if (effectiveReplyType() === 'reply') {
      return <IconButton icon={Reply} showChevron />;
    } else if (effectiveReplyType() === 'reply-all') {
      return <IconButton icon={ReplyAll} showChevron />;
    } else {
      return <IconButton icon={Forward} showChevron />;
    }
  });

  return (
    <div
      ref={(el) => {
        composeContainerRef = el;
      }}
      class={`relative flex-1 flex flex-col border border-edge px-3 py-2 bg-input`}
    >
      {/* Top Bar */}
      <div class="flex items-start gap-2">
        <DropdownMenu>
          <DropdownMenu.Trigger>{ReplyIcon()}</DropdownMenu.Trigger>
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
              class="flex items-center text-sm font-mono truncate overflow-hidden"
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
          <div ref={setExpandedRecipientsRef}>
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
          class="flex-1 text-sm bg-transparent outline-none border-0 px-2 py-1"
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
          class="min-h-20 max-h-80 overflow-y-scroll w-full flex flex-col cursor-text"
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
            captureEditor={setEditor}
            class={`text-sm break-words text-ink ${isDragging() && 'blur'}`}
            editable={() => !isPendingSend()}
            initialValue={props.preloadedBody}
            initialHtml={props.preloadedHtml}
            placeholder=""
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
        <Show when={!replyAppended()}>
          <div class="flex flex-row items-center space-x-2">
            <IconButton
              theme="clear"
              icon={DotsThree}
              onclick={() => {
                setReplyAppended(true);
                editor()?.dispatchCommand(APPEND_PREVIOUS_EMAIL_COMMAND, {
                  replyingTo: props.replyingTo(),
                  replyType: effectiveReplyType(),
                });
                editor()?.update(() => {
                  $getRoot().getFirstChild()?.selectStart();
                });
              }}
            />
          </div>
        </Show>
        <div class="flex flex-row items-center space-x-2">
          <div class="relative" ref={attachButtonRef}>
            <IconButton
              theme="clear"
              icon={Plus}
              tooltip={{ label: 'Attach' }}
              onClick={() => setAttachMenuOpen(true)}
            />
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
          <IconButton
            theme="clear"
            icon={TextAa}
            onclick={() => {
              setShowFormatRibbon(!showFormatRibbon());
            }}
          />
          <Show when={savedDraftId()}>
            <IconButton
              theme="clear"
              icon={Trash}
              onclick={handleDeleteDraft}
              tooltip={{ label: 'Delete draft' }}
            />
          </Show>
          <div class="ml-auto flex flex-row">
            <button
              disabled={isPendingUpload() || isPendingSend()}
              onClick={() => {
                sendEmail();
              }}
              class="text-ink-muted bg-transparent rounded-full hover:scale-110! transition ease-in-out delay-150 flex flex-col justify-center items-center"
            >
              <div class="bg-transparent rounded-full size-8 flex flex-row justify-center items-center">
                <Show
                  when={!isPendingUpload() && !isPendingSend()}
                  fallback={
                    <Spinner class="w-5 h-5 animate-spin cursor-disabled" />
                  }
                >
                  <PaperPlaneRight
                    width={20}
                    height={20}
                    class="!text-accent-ink !fill-accent"
                  />
                </Show>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
