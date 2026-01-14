import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import {
  SplitHeaderBadge,
  StaticSplitLabel,
} from '@app/component/split-layout/components/SplitLabel';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { useHasPaidAccess } from '@core/auth';
import { CircleSpinner } from '@core/component/CircleSpinner';
import { ClippedPanel } from '@core/component/ClippedPanel';
import { DeprecatedTextButton } from '@core/component/DeprecatedTextButton';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { toast } from '@core/component/Toast/Toast';
import { usePaywallState } from '@core/constant/PaywallState';
import { useEmailLinks } from '@core/email-link';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import {
  type ContactInfo,
  tryMacroId,
  useDisplayName,
  type WithCustomUserInput,
} from '@core/user';
import Caution from '@icon/regular/warning.svg';
import { useEmailLinksQuery } from '@queries/email/link';
import { useSendMessageMutation } from '@queries/email/thread';
import {
  createMemo,
  createSignal,
  Match,
  onMount,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { beveledCorners } from '../../block-theme/signals/themeSignals';
import { ComposeEmailInput } from './ComposeEmailInput';
import {
  createEmailFormState,
  type DraftFormAttachment,
} from '@block-email/component/createEmailFormState';
import { logger } from '@observability/logger';
import { debounce } from '@solid-primitives/scheduled';
import type { LexicalEditor } from 'lexical';
import {
  $appendWatermarkNodeToLast,
  $removeAllWatermarkNodes,
} from '@lexical-core';
import { prepareEmailBody } from '@block-email/util/prepareEmailBody';
import { convertEmailRecipientToContactInfo } from '@block-email/util/recipientConversion';
import {
  deleteEmailDraft,
  saveEmailDraft,
} from '@block-email/signal/emailDraft';
import {
  useRemoveDraftAttachmentMutation,
  useUploadDraftAttachmentsMutation,
} from '@queries/email/attachment';
import { MACRO_EMAIL_SIGNATURE } from '@block-email/constants';

const DRAFT_DEBOUNCE_MS = 1000;

type EmailComposeErrors =
  | 'no_recipient'
  | 'no_message'
  | 'no_subject'
  | 'no_link';

class EmailComposeError {
  constructor(
    public type: EmailComposeErrors,
    public message: string
  ) {}
}

type EmailComposeElementRefs = {
  directRecipientsSelector: HTMLElement | undefined;
  ccRecipientsSelector: HTMLElement | undefined;
  bccRecipientsSelector: HTMLElement | undefined;
  containerRef: HTMLElement | undefined;
  subjectInput: HTMLElement | undefined;
  messageInput: HTMLElement | undefined;
};

export function EmailCompose() {
  const hasPaidAccess = useHasPaidAccess();
  const { showPaywall } = usePaywallState();

  const emailLinksQuery = useEmailLinksQuery();

  const [refs, setRefs] = createSignal<EmailComposeElementRefs>({
    directRecipientsSelector: undefined,
    ccRecipientsSelector: undefined,
    bccRecipientsSelector: undefined,
    containerRef: undefined,
    subjectInput: undefined,
    messageInput: undefined,
  });

  const registerRef = (name: keyof EmailComposeElementRefs) => {
    return (el: HTMLElement) => {
      setRefs((p) => ({ ...p, [name]: el }));
    };
  };

  const [attachComposeHotkeys, composeHotkeyScope] =
    useHotkeyDOMScope('compose-email');

  const link = createMemo(() => {
    const data = emailLinksQuery.data;
    if (data && data.links.length > 0) {
      return data.links[0];
    }
    return undefined;
  });

  const hasLinkError = createMemo(() => {
    if (emailLinksQuery.isPending) return false;
    return (
      emailLinksQuery.isError ||
      (emailLinksQuery.data && emailLinksQuery.data.links.length === 0)
    );
  });

  const { users: destinationOptions } = useCombinedRecipients();

  const form = createEmailFormState();

  const [editor, setEditor] = createSignal<LexicalEditor | undefined>();

  const [content, setContent] = createSignal('');
  const [currentDraftID, setCurrentDraftID] = createSignal<
    string | undefined
  >();

  const uploadAttachmentMutation = useUploadDraftAttachmentsMutation();

  function collectDraft() {
    $removeAllWatermarkNodes(editor());
    const prepared = prepareEmailBody(editor());
    if (!prepared) {
      logger.error(
        new Error('Unable to prepare email body for draft collection.')
      );
      return null;
    }
    // Fail if no body text and no attachments
    // You can have a draft with attachments and no body text
    if (
      prepared.bodyText.trim() === '' &&
      form.attachments.list().length === 0
    ) {
      return null;
    }
    // We attach the drafts entirely using bodyHTML (because this is how the appended reply parsing works) so we are not including bodyMacro or bodyText
    return {
      bcc: form.recipients().bcc.map(convertEmailRecipientToContactInfo),
      body_html: prepared.bodyHtml,
      cc: form.recipients().cc.map(convertEmailRecipientToContactInfo),
      subject: form.subject(),
      to: form.recipients().to.map(convertEmailRecipientToContactInfo),
    };
  }

  async function executeSaveDraft() {
    if (sendMutation.isPending) {
      return;
    }
    const draftToSave = collectDraft();
    if (!draftToSave) {
      const draftID = currentDraftID();
      if (draftID) {
        await deleteEmailDraft(draftID);
      }
      setCurrentDraftID(undefined);
      return;
    }

    const linkID = link()?.id;
    if (!linkID || hasLinkError()) {
      logger.error(
        new Error('Failed to save email draft: could not load email links')
      );
      return false;
    }

    const draftResponse = await saveEmailDraft({
      ...draftToSave,
      link_id: linkID,
    });

    if (draftResponse) {
      // If the email draft saved successfully, we want to upload the
      // attachments as well. We should grab only the attachments that
      // haven't been uploaded yet
      const attachments = form.attachments
        .list()
        .filter((a) => a.type === 'local' && !a.attachmentID) as Extract<
        DraftFormAttachment,
        { type: 'local' }
      >[];

      if (attachments.length) {
        const uploaded = await uploadAttachmentMutation.mutateAsync({
          draftID: draftResponse,
          attachments: attachments.map((a) => a.file),
        });

        // Assign the attachment ids to attachments for later use
        for (const attachment of uploaded.attachments) {
          form.attachments.assignAttachmentID(
            attachment.file,
            attachment.attachmentID
          );
        }
      }

      setCurrentDraftID(draftResponse);
    }
  }

  const scheduleDraftSave = debounce(() => {
    void executeSaveDraft();
  }, DRAFT_DEBOUNCE_MS);

  const onAddAttachments = (attachments: DraftFormAttachment[]) => {
    for (const attachment of attachments) {
      form.attachments.add(attachment);
    }
    scheduleDraftSave();
  };

  const removeAttachmentMutation = useRemoveDraftAttachmentMutation();

  const handleRemoveAttachment = (attachment: DraftFormAttachment) => {
    if (attachment.type === 'local') {
      form.attachments.removeByFile(attachment.file);
    } else {
      form.attachments.removeByID(attachment.attachmentID);
    }

    const savedDraftID = currentDraftID();

    if (!savedDraftID || !attachment.attachmentID) return;

    removeAttachmentMutation.mutate({
      draftID: savedDraftID,
      attachmentID: attachment.attachmentID,
    });
  };

  // We are consuming the first change, because it is the initial value
  let firstChangeConsumed = false;
  const onContentChange = (content: string) => {
    setContent(content);
    if (!firstChangeConsumed) {
      firstChangeConsumed = true;
      return;
    }
    scheduleDraftSave();
  };

  const [showCc, setShowCc] = createSignal(false);
  const [showBcc, setShowBcc] = createSignal(false);

  onMount(() => {
    const container = refs().containerRef;
    if (!container) return;
    attachComposeHotkeys(container);
  });

  registerHotkey({
    hotkey: 'shift+cmd+o',
    scopeId: composeHotkeyScope,
    description: 'Edit "To" recipients',
    keyDownHandler: () => {
      refs()?.directRecipientsSelector?.focus();
      return true;
    },
    runWithInputFocused: true,
    hotkeyToken: TOKENS.email.compose.edit.recipients,
    shouldReturnFocusOnClose: false,
  });

  registerHotkey({
    hotkey: 'shift+cmd+c',
    scopeId: composeHotkeyScope,
    description: 'Edit "Cc" recipients',
    keyDownHandler: () => {
      const visible = showCc();
      if (!visible) {
        setShowCc(true);
        queueMicrotask(() => refs()?.ccRecipientsSelector?.focus());
        return true;
      }

      refs()?.ccRecipientsSelector?.focus();

      return true;
    },
    runWithInputFocused: true,
    hotkeyToken: TOKENS.email.compose.edit.ccRecipients,
    shouldReturnFocusOnClose: false,
  });

  registerHotkey({
    hotkey: 'shift+cmd+b',
    scopeId: composeHotkeyScope,
    description: 'Edit "Bcc" recipients',
    keyDownHandler: () => {
      const visible = showBcc();
      if (!visible) {
        setShowBcc(true);
        queueMicrotask(() => refs()?.bccRecipientsSelector?.focus());
        return true;
      }

      refs()?.bccRecipientsSelector?.focus();

      return true;
    },
    runWithInputFocused: true,
    hotkeyToken: TOKENS.email.compose.edit.bccRecipients,
    shouldReturnFocusOnClose: false,
  });

  registerHotkey({
    hotkey: 'shift+cmd+s',
    scopeId: composeHotkeyScope,
    description: 'Edit subject',
    keyDownHandler: () => {
      refs()?.subjectInput?.focus();
      return true;
    },
    runWithInputFocused: true,
    hotkeyToken: TOKENS.email.compose.edit.subject,
    shouldReturnFocusOnClose: false,
  });

  registerHotkey({
    hotkey: 'shift+cmd+m',
    scopeId: composeHotkeyScope,
    description: 'Edit message',
    keyDownHandler: () => {
      refs()?.messageInput?.focus();
      return true;
    },
    runWithInputFocused: true,
    hotkeyToken: TOKENS.email.compose.edit.message,
    shouldReturnFocusOnClose: false,
  });

  const { connect: connectEmail } = useEmailLinks();

  const previewName = createMemo(() => {
    const recipients = form.recipients().to;
    if (recipients.length === 0) {
      return 'Draft email';
    }

    if (recipients.length === 1) {
      let recipientName = recipients[0].data.email;

      if (recipients[0].kind === 'user') {
        recipientName = useDisplayName(tryMacroId(recipients[0].data.id))[0]();
      }

      return recipientName ? `Email to ${recipientName}` : 'Draft email';
    }

    const names = recipients
      .slice(0, 2)
      .map((r) => {
        if (r.kind === 'user') {
          return useDisplayName(tryMacroId(r.data.id))[0]();
        }
        return r.data.email || 'Unknown';
      })
      .filter(Boolean);

    if (recipients.length > 2) {
      return `Email to ${names.join(', ')}, and others`;
    }

    return `Email to ${names.join(' and ')}`;
  });

  const { replaceSplit } = useSplitLayout();

  const [validationError, setValidationError] =
    createSignal<EmailComposeError | null>(null);

  const sendMutation = useSendMessageMutation({
    onSuccess: (data) => {
      toast.success('Email sent');
      if (data.message.thread_db_id) {
        replaceSplit({
          content: { type: 'email', id: data.message.thread_db_id },
          mergeHistory: true,
        });
      }
    },
    onError: () => {
      toast.failure('Failed to send email');
    },
  });

  const onSubmit = () => {
    setValidationError(null);

    const currentEditor = editor();

    // We handle cleaning up the signature after we've sent the request because
    // otherwise the `bodyMacro` signal would update after the clean up call and
    // not contain the signature in the request data
    const cleanupWatermark = $appendWatermarkNodeToLast(
      currentEditor,
      !hasPaidAccess() ? MACRO_EMAIL_SIGNATURE : undefined
    );

    const prepared = prepareEmailBody(currentEditor, undefined);
    if (!prepared) return;

    const bodyMacro = content();

    const data = {
      text: prepared.bodyText,
      html: prepared.bodyHtml,
      raw: bodyMacro,
    };

    const currentLink = link();

    const recipients = form.recipients();

    if (!recipients.to.length) {
      setValidationError(
        new EmailComposeError(
          'no_recipient',
          'Please select at least one recipient'
        )
      );
      return;
    }

    if (!data.raw.trim()) {
      setValidationError(
        new EmailComposeError('no_message', 'Please enter a message')
      );
      return;
    }

    if (!form.subject()?.trim()) {
      setValidationError(
        new EmailComposeError('no_subject', 'Please enter a subject')
      );
      return;
    }

    if (!currentLink) {
      setValidationError(
        new EmailComposeError('no_link', 'Unable to find linked email account')
      );
      return;
    }

    sendMutation.mutate({
      message: {
        link_id: currentLink.id,
        to: convertToContactInfoArray(recipients.to),
        cc:
          recipients.cc.length > 0
            ? convertToContactInfoArray(recipients.cc)
            : [],
        bcc:
          recipients.bcc.length > 0
            ? convertToContactInfoArray(recipients.bcc)
            : [],
        subject: form.subject(),
        body_text: data.text,
        body_html: data.html,
        body_macro: data.raw,
        db_id: currentDraftID(),
      },
    });

    cleanupWatermark();
  };

  const withValidationError = (type: EmailComposeErrors) => {
    const error = validationError();
    if (error?.type === type) return error;
    return undefined;
  };

  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel
          label={form.subject() || previewName()}
          iconType="email"
          badges={[
            <SplitHeaderBadge text="draft" tooltip="This is a Draft Email" />,
          ]}
        />
      </SplitHeaderLeft>
      <div
        ref={registerRef('containerRef')}
        class="relative flex flex-col w-full h-full panel min-h-0 overflow-hidden"
      >
        <Switch>
          <Match when={hasLinkError()}>
            <div class="w-full bg-alert-bg border-b border-t border-alert/20 text-alert-ink p-2">
              <div class="flex items-center justify-between gap-2">
                <Caution class="size-4" />
                <span class="text-sm">
                  You have not connected an email account.
                </span>
                <span class="grow" />
                <DeprecatedTextButton
                  theme="base"
                  text="Connect Email"
                  onClick={connectEmail}
                />
              </div>
            </div>
          </Match>
          <Match when={!hasPaidAccess()}>
            <div class="w-full bg-alert-bg border-b border-t border-alert/20 text-alert-ink p-2">
              <div class="flex items-center justify-between gap-2">
                <Caution class="size-4" />
                <span class="text-sm">You must upgrade to send email.</span>
                <span class="grow" />
                <DeprecatedTextButton
                  theme="base"
                  text="Upgrade"
                  onClick={() => {
                    showPaywall(null);
                  }}
                />
              </div>
            </div>
          </Match>
        </Switch>

        <div
          class="macro-message-width mx-auto w-full max-h-full my-12 overflow-hidden px-4"
          classList={{
            'pointer-events-none opacity-50': hasLinkError(),
          }}
        >
          <ClippedPanel tl={!beveledCorners()}>
            <div
              class="w-full p-4 bg-input max-h-full overflow-hidden flex flex-col min-h-0"
              classList={{
                'pointer-events-none opacity-50': hasLinkError(),
              }}
            >
              <div class="macro-message-width mx-auto pb-1 w-full h-max shrink-0">
                <div class="mb-4 h-6 flex items-center justify-between">
                  <Suspense
                    fallback={
                      <div class="flex gap-1 items-center">
                        <CircleSpinner class="w-4 h-4 animate-spin" />
                        <span class="text-ink-extra-muted/50 text-xs">
                          Processing...
                        </span>
                      </div>
                    }
                  >
                    <Show when={link()}>
                      {(link) => (
                        <div class="text-xs text-ink-extra-muted/50">
                          from {link().email_address}
                        </div>
                      )}
                    </Show>
                  </Suspense>
                  <div class="flex gap-2 ml-auto">
                    <Show when={!showCc()}>
                      <button
                        type="button"
                        class="text-sm text-secondary-text hover:text-primary-text hover:bg-hover"
                        onClick={() => setShowCc(true)}
                        disabled={hasLinkError()}
                      >
                        + Cc
                      </button>
                    </Show>
                    <Show when={!showBcc()}>
                      <button
                        type="button"
                        class="text-sm text-secondary-text hover:text-primary-text hover:bg-hover"
                        onClick={() => setShowBcc(true)}
                        disabled={hasLinkError()}
                      >
                        + Bcc
                      </button>
                    </Show>
                  </div>
                </div>

                <div class="flex flex-col gap-2">
                  <div class="flex items-center gap-2 border-b border-edge-muted focus-within:border-accent">
                    <div class="text-base w-4 shrink-0 text-ink-placeholder/70">
                      To
                    </div>
                    <div class="flex-1">
                      <RecipientSelector<'user' | 'contact'>
                        inputRef={registerRef('directRecipientsSelector')}
                        options={destinationOptions}
                        selectedOptions={form.recipients().to}
                        setSelectedOptions={(next) =>
                          form.setRecipients('to', next)
                        }
                        placeholder="Macro users or email addresses"
                        focusOnMount={!hasLinkError()}
                        hideBorder
                        noBrackets
                        disabled={hasLinkError()}
                      />
                    </div>
                    <Show when={withValidationError('no_recipient')}>
                      {(err) => (
                        <div class="text-failure-ink text-sm mt-1">
                          {err().message}
                        </div>
                      )}
                    </Show>
                  </div>

                  <Show when={showCc()}>
                    <div class="flex items-center gap-2 border-b border-edge-muted focus-within:border-accent">
                      <div class="text-sm w-4 shrink-0 text-ink-placeholder/70">
                        Cc
                      </div>
                      <div class="flex-1">
                        <RecipientSelector<'user' | 'contact'>
                          inputRef={registerRef('ccRecipientsSelector')}
                          options={destinationOptions}
                          selectedOptions={form.recipients().cc}
                          setSelectedOptions={(next) =>
                            form.setRecipients('cc', next)
                          }
                          placeholder="Macro users or email addresses"
                          hideBorder
                          noBrackets
                          disabled={hasLinkError()}
                        />
                      </div>
                    </div>
                  </Show>

                  <Show when={showBcc()}>
                    <div class="flex items-center gap-2 border-b border-edge-muted focus-within:border-accent">
                      <div class="text-sm w-4 shrink-0 text-ink-placeholder/70">
                        Bcc
                      </div>
                      <div class="flex-1">
                        <RecipientSelector<'user' | 'contact'>
                          inputRef={registerRef('bccRecipientsSelector')}
                          options={destinationOptions}
                          selectedOptions={form.recipients().bcc}
                          setSelectedOptions={(next) =>
                            form.setRecipients('bcc', next)
                          }
                          placeholder="Macro users or email addresses"
                          hideBorder
                          noBrackets
                          disabled={hasLinkError()}
                        />
                      </div>
                    </div>
                  </Show>

                  <div class="w-full flex items-center gap-2 border-b border-edge-muted focus-within:border-accent py-2">
                    <div class="text-base shrink-0 text-ink-placeholder/70">
                      Subject
                    </div>

                    <div class="flex-1">
                      <input
                        ref={registerRef('subjectInput')}
                        type="text"
                        value={form.subject()}
                        placeholder="Subject"
                        class="w-full text-base resize-none placeholder:text-ink-placeholder p-1 ml-1"
                        onInput={(e) => {
                          form.setSubject(e.currentTarget.value);
                          scheduleDraftSave();
                        }}
                        disabled={hasLinkError()}
                      />
                    </div>

                    <Show when={withValidationError('no_subject')}>
                      {(err) => (
                        <div class="text-failure-ink text-sm mt-1">
                          {err().message}
                        </div>
                      )}
                    </Show>
                  </div>
                </div>
              </div>

              <div
                class="w-full h-full flex flex-col min-h-0 mt-4"
                classList={{
                  'pointer-events-none opacity-50': hasLinkError(),
                }}
              >
                <ComposeEmailInput
                  captureEditor={setEditor}
                  inputRef={registerRef('messageInput')}
                  onContentChange={onContentChange}
                  onAddAttachments={onAddAttachments}
                  onRemoveAttachment={handleRemoveAttachment}
                  attachments={form.attachments.list()}
                  onSubmit={onSubmit}
                  isSubmitting={sendMutation.isPending}
                  disabled={hasLinkError() || sendMutation.isPending}
                />
                <Show when={withValidationError('no_message')}>
                  {(err) => (
                    <div class="text-failure-ink text-sm mt-1">
                      {err().message}
                    </div>
                  )}
                </Show>
              </div>
            </div>
          </ClippedPanel>
        </div>
      </div>
    </>
  );
}

function convertToContactInfoArray(
  recipients: WithCustomUserInput<'user' | 'contact'>[]
): ContactInfo[] {
  return recipients.map((recipient) => ({
    email: recipient.data.email,
    name:
      'name' in recipient.data ? recipient.data.name || undefined : undefined,
  }));
}
