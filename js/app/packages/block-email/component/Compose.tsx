import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import {
  SplitHeaderBadge,
  StaticSplitLabel,
} from '@app/component/split-layout/components/SplitLabel';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { useHasPaidAccess } from '@core/auth';
import { CircleSpinner } from '@core/component/CircleSpinner';
import { ClippedPanel } from '@core/component/ClippedPanel';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { TextButton } from '@core/component/TextButton';
import { toast } from '@core/component/Toast/Toast';
import { usePaywallState } from '@core/constant/PaywallState';
import { useEmailLinks } from '@core/email-link';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import {
  type ContactInfo,
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
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { ComposeEmailInput, type ComposeInputData } from './ComposeEmailInput';

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

export function EmailCompose() {
  const hasPaidAccess = useHasPaidAccess();
  const { showPaywall } = usePaywallState();

  const [subject, setSubject] = createSignal<string>('');

  const emailLinksQuery = useEmailLinksQuery();

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
  const [selectedRecipients, setSelectedRecipients] = createSignal<
    WithCustomUserInput<'user' | 'contact'>[]
  >([]);
  const [ccRecipients, setCcRecipients] = createSignal<
    WithCustomUserInput<'user' | 'contact'>[]
  >([]);
  const [bccRecipients, setBccRecipients] = createSignal<
    WithCustomUserInput<'user' | 'contact'>[]
  >([]);

  const [showCc, setShowCc] = createSignal(false);
  const [showBcc, setShowBcc] = createSignal(false);

  const [triedToSubmit, _setTriedToSubmit] = createSignal(false);

  const { connect: connectEmail } = useEmailLinks();

  const previewName = createMemo(() => {
    const recipients = selectedRecipients();
    if (recipients.length === 0) {
      return 'Draft email';
    } else if (recipients.length === 1) {
      const recipientName =
        recipients[0].kind === 'user'
          ? useDisplayName(recipients[0].data.id)[0]()
          : recipients[0].data.email;
      return recipientName ? `Email to ${recipientName}` : 'Draft email';
    } else {
      const names = recipients
        .slice(0, 2)
        .map((r) => {
          if (r.kind === 'user') {
            return useDisplayName(r.data.id)[0]();
          }
          return r.data.email || 'Unknown';
        })
        .filter(Boolean);

      if (recipients.length > 2) {
        return `Email to ${names.join(', ')}, and others`;
      } else {
        return `Email to ${names.join(' and ')}`;
      }
    }
  });

  const { replaceSplit } = useSplitLayout();

  const [validationError, setValidationError] =
    createSignal<EmailComposeError | null>(null);

  const sendMutation = useSendMessageMutation({
    onSuccess: (data) => {
      toast.success('Email sent');
      if (data.message.thread_db_id) {
        replaceSplit({ type: 'email', id: data.message.thread_db_id }, true);
      }
    },
    onError: () => {
      toast.failure('Failed to send email');
    },
  });

  const onSubmit = (data: ComposeInputData) => {
    setValidationError(null);

    const _link = link();

    if (!selectedRecipients().length) {
      setValidationError(
        new EmailComposeError(
          'no_recipient',
          'Please select at least one recipient'
        )
      );
      return;
    }

    if (!data.body.raw.trim()) {
      setValidationError(
        new EmailComposeError('no_message', 'Please enter a message')
      );
      return;
    }

    if (!subject()?.trim()) {
      setValidationError(
        new EmailComposeError('no_subject', 'Please enter a subject')
      );
      return;
    }

    if (!_link) {
      setValidationError(
        new EmailComposeError('no_link', 'Unable to find linked email account')
      );
      return;
    }

    sendMutation.mutate({
      message: {
        link_id: _link.id,
        to: convertToContactInfoArray(selectedRecipients()),
        cc:
          ccRecipients().length > 0
            ? convertToContactInfoArray(ccRecipients())
            : [],
        bcc:
          bccRecipients().length > 0
            ? convertToContactInfoArray(bccRecipients())
            : [],
        subject: subject(),
        body_text: data.body.text,
        body_html: data.body.html,
        body_macro: data.body.raw,
        attachments: [],
      },
    });
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
          label={subject() || previewName()}
          iconType="email"
          badges={[
            <SplitHeaderBadge text="draft" tooltip="This is a Draft Email" />,
          ]}
        />
      </SplitHeaderLeft>
      <div class="relative flex flex-col w-full h-full panel min-h-0 overflow-hidden">
        <Switch>
          <Match when={hasLinkError()}>
            <div class="w-full bg-alert-bg border-b border-t border-alert/20 text-alert-ink p-2">
              <div class="flex items-center justify-between gap-2">
                <Caution class="size-4" />
                <span class="text-sm">
                  You have not connected an email account.
                </span>
                <span class="grow" />
                <TextButton
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
                <TextButton
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
          <ClippedPanel tl tr>
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
                        options={destinationOptions}
                        selectedOptions={selectedRecipients}
                        setSelectedOptions={setSelectedRecipients}
                        placeholder="Macro users or email addresses"
                        triedToSubmit={triedToSubmit}
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
                          options={destinationOptions}
                          selectedOptions={ccRecipients}
                          setSelectedOptions={setCcRecipients}
                          placeholder="Macro users or email addresses"
                          triedToSubmit={triedToSubmit}
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
                          options={destinationOptions}
                          selectedOptions={bccRecipients}
                          setSelectedOptions={setBccRecipients}
                          placeholder="Macro users or email addresses"
                          triedToSubmit={triedToSubmit}
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
                        type="text"
                        value={subject()}
                        placeholder="Subject"
                        class="w-full text-base resize-none placeholder:text-ink-placeholder p-1 ml-1"
                        onInput={(e) => {
                          setSubject(e.currentTarget.value);
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
                  onSubmit={onSubmit}
                  isSubmitting={sendMutation.isPending}
                  disabled={hasLinkError()}
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
