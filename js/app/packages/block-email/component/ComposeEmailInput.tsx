import { useSplitLayout } from '@app/component/split-layout/layout';
import { useSplitPanel } from '@app/component/split-layout/layoutUtils';
import { globalSplitManager } from '@app/signal/splitLayout';
import { FormatRibbon } from '@block-channel/component/FormatRibbon';
import { FileDropOverlay } from '@core/component/FileDropOverlay';
import { IconButton } from '@core/component/IconButton';
import { MarkdownTextarea } from '@core/component/LexicalMarkdown/component/core/MarkdownTextarea';
import { toast } from '@core/component/Toast/Toast';
import { fileDrop } from '@core/directive/fileDrop';
import type { WithCustomUserInput } from '@core/user';
import { isErr } from '@core/util/maybeResult';
import PaperPlaneRight from '@icon/regular/paper-plane-right.svg';
import Plus from '@icon/regular/plus.svg';
import TextAa from '@icon/regular/text-aa.svg';
import type { DocumentMentionInfo } from '@lexical-core';
import Spinner from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
import { emailClient } from '@service-email/client';
import type {
  ContactInfo,
  Link as EmailAccountLink,
  MessageToSend,
} from '@service-email/generated/schemas';
import { useUserId } from '@service-gql/client';
import type { FileType } from '@service-storage/generated/schemas/fileType';
import type { Item } from '@service-storage/generated/schemas/item';
import {
  defaultSelectionData,
  type SelectionData,
} from 'core/component/LexicalMarkdown/plugins';
import {
  NODE_TRANSFORM,
  type NodeTransformType,
} from 'core/component/LexicalMarkdown/plugins/node-transform/nodeTransformPlugin';
import { registerHotkey, useHotkeyDOMScope } from 'core/hotkey/hotkeys';
import {
  FORMAT_TEXT_COMMAND,
  type LexicalEditor,
  type TextFormatType,
} from 'lexical';
import { createSignal, onMount, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { type FocusableElement, tabbable } from 'tabbable';
import { handleFileUpload } from '../util/handleFileUpload';
import { makeAttachmentPublic } from '../util/makeAttachmentPublic';
import {
  appendItemsAsMacroMentions,
  prepareEmailBody,
} from '../util/prepareEmailBody';
import { AttachMenu } from './AttachMenu';

false && fileDrop;

export function ComposeEmailInput(props: {
  selectedRecipients: () => WithCustomUserInput<'user' | 'contact'>[];
  ccRecipients: () => WithCustomUserInput<'user' | 'contact'>[];
  bccRecipients: () => WithCustomUserInput<'user' | 'contact'>[];
  subject: () => string;
  link: EmailAccountLink | null;
  inputAttachments?: {
    store: Record<string, any[]>;
    setStore: any;
    key: string;
  };
}) {
  const [editor, setEditor] = createSignal<LexicalEditor>();
  const [isDragging, setIsDragging] = createSignal<boolean>();
  const [isPendingUpload, setIsPendingUpload] = createSignal<boolean>(false);
  const [showFormatRibbon, setShowFormatRibbon] = createSignal<boolean>(false);
  const [formatState] = createStore<SelectionData>(
    structuredClone(defaultSelectionData)
  );
  const [attachMenuOpen, setAttachMenuOpen] = createSignal(false);
  const [content, setContent] = createSignal('');
  const [error, setError] = createSignal(false);
  const [errorMsg, setErrorMsg] = createSignal('');
  const [sending, setSending] = createSignal(false);

  const panel = useSplitPanel();

  const focusSibling = (direction: 'next' | 'prev') => {
    const panelRef = panel?.panelRef();
    if (!panelRef) return;
    const tabbableEls = tabbable(panelRef);
    const activeEl = document.activeElement;
    const activeElIndex = tabbableEls.indexOf(activeEl as FocusableElement);
    if (activeElIndex > -1) {
      const ndx = activeElIndex + (direction === 'next' ? 1 : -1);
      if (ndx < 0 || ndx >= tabbableEls.length) return false;
      const prevEl = tabbableEls[ndx];
      if (!prevEl) return false;
      prevEl.focus();
      return true;
    } else {
      tabbableEls.at(-1)?.focus();
      return true;
    }
  };

  useUserId();

  let bodyDiv!: HTMLDivElement;
  let attachButtonRef!: HTMLDivElement;

  function failure(msg: string) {
    setError(true);
    setErrorMsg(msg);
  }

  const convertToContactInfoArray = (
    recipients: WithCustomUserInput<'user' | 'contact'>[]
  ): ContactInfo[] => {
    return recipients.map((recipient) => ({
      email: recipient.data.email,
      name:
        'name' in recipient.data ? recipient.data.name || undefined : undefined,
    }));
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
  }

  function onAttachDocuments(items: DocumentMentionInfo[]) {
    console.log('ComposeEmailInput: onAttachDocuments called with', items);
    console.log('ComposeEmailInput: Current editor state:', editor());
    appendItemsAsMacroMentions(editor(), items);
    items.forEach((item) => {
      makeAttachmentPublic(item.documentId);
    });
    console.log('ComposeEmailInput: Document attachments processed');
  }

  const { replaceSplit } = useSplitLayout();

  // Set up hotkey scope for the compose message component
  const [attachComposeHotkeys, composeHotkeyScope] =
    useHotkeyDOMScope('compose-message');
  let composeContainerRef: HTMLDivElement | undefined;

  async function handleSend() {
    if (sending()) return;

    const prepared = prepareEmailBody(editor());
    if (!prepared) return;

    setError(false);
    setSending(true);

    const toRecipients = props?.selectedRecipients?.();
    const ccRecipients = props?.ccRecipients?.();
    const bccRecipients = props?.bccRecipients?.();
    const subject = props?.subject?.();
    const bodyMacro = content();

    try {
      if (!toRecipients || toRecipients.length === 0) {
        const e = 'Please select at least one recipient';
        failure(e);
        return;
      }

      if (!bodyMacro?.trim()) {
        const e = 'Please enter a message';
        failure(e);
        return;
      }

      if (!subject?.trim()) {
        const e = 'Please enter a subject';
        failure(e);
        return;
      }
      if (!props.link) {
        const e = 'Unable to find linked email account';
        failure(e);
        return;
      }

      const messageToSend: MessageToSend = {
        link_id: props.link.id, // For new emails
        to: convertToContactInfoArray(toRecipients),
        cc:
          ccRecipients && ccRecipients.length > 0
            ? convertToContactInfoArray(ccRecipients)
            : [],
        bcc:
          bccRecipients && bccRecipients.length > 0
            ? convertToContactInfoArray(bccRecipients)
            : [],
        subject: subject,
        body_text: prepared.bodyText,
        body_html: prepared.bodyHtml,
        body_macro: bodyMacro,
        attachments: [],
      };

      const result = await emailClient.sendMessage({
        message: messageToSend,
      });

      if (isErr(result)) {
        const e = 'Failed to send email';
        failure(e);
        return;
      }
      toast.success('Email sent');

      const [, { message }] = result;

      if (message.thread_db_id) {
        replaceSplit({ type: 'email', id: message.thread_db_id }, true);
      }
      globalSplitManager();
    } catch (error) {
      console.error('Failed to send email:', error);
      failure('Failed to send email');
    } finally {
      setSending(false);
    }
  }

  onMount(() => {
    if (composeContainerRef) {
      attachComposeHotkeys(composeContainerRef);

      registerHotkey({
        hotkey: 'cmd+enter',
        scopeId: composeHotkeyScope,
        description: 'Send email',
        keyDownHandler: () => {
          handleSend();
          return true;
        },
        runWithInputFocused: true,
        hotkeyToken: 'email.send',
        displayPriority: 10,
      });
    }
  });

  return (
    <div
      ref={(el) => {
        composeContainerRef = el;
      }}
      class="w-full h-full relative flex-1 flex flex-col py-2"
    >
      <Show when={error()}>
        <div class="text-failure-ink text-sm mt-1">{errorMsg()}</div>
      </Show>
      <div class="w-full h-full flex flex-col">
        <div
          class="min-h-20 grow w-full h-full flex flex-col cursor-text"
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
                // scheduleDraftSave();
              });
            },
          }}
        >
          <div class={`${!isDragging() && 'hidden'} absolute inset-0`}>
            <FileDropOverlay>Drop file(s) to attach</FileDropOverlay>
          </div>
          <MarkdownTextarea
            captureEditor={setEditor}
            class="text-sm break-words text-ink"
            editable={() => true}
            placeholder="Use `@` to reference files"
            onChange={setContent}
            onFocusLeaveStart={(e) => {
              e.preventDefault();
              focusSibling('prev');
            }}
            onFocusLeaveEnd={(e) => {
              e.preventDefault();
              focusSibling('next');
            }}
            // onDocumentMention={(item) => {
            //   makeAttachmentPublic(item.id);
            // }}
            // onUserMention={handleUserMention}
            portalScope="local"
            // formatState={formatState}
            // setFormatState={setFormatState}
          />
        </div>
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
        <div class="flex flex-row items-center space-x-2 p-1 border-edge-muted border-t">
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
          <div class="ml-auto flex flex-row">
            <Show
              when={!isPendingUpload() && !sending()}
              fallback={
                <Spinner class="w-5 h-5 animate-spin cursor-disabled" />
              }
            >
              <IconButton
                theme="clear"
                icon={PaperPlaneRight}
                tooltip={{ label: 'Send' }}
                onClick={handleSend}
              />
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}
