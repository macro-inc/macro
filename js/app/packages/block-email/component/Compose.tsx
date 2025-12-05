import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import {
  SplitHeaderBadge,
  StaticSplitLabel,
} from '@app/component/split-layout/components/SplitLabel';
import { useHasPaidAccess } from '@core/auth';
import { CircleSpinner } from '@core/component/CircleSpinner';
import { ClippedPanel } from '@core/component/ClippedPanel';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { TextButton } from '@core/component/TextButton';
import { usePaywallState } from '@core/constant/PaywallState';
import { useEmailLinks } from '@core/email-link';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import {
  type ContactInfo,
  useDisplayName,
  type WithCustomUserInput,
} from '@core/user';
import { isErr } from '@core/util/maybeResult';
import Caution from '@icon/regular/warning.svg';
import { emailClient } from '@service-email/client';
import {
  createMemo,
  createResource,
  createSignal,
  Match,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { ComposeEmailInput, type ComposeInputData } from './ComposeEmailInput';
import { useMutation } from '@tanstack/solid-query';
import { toast } from '@core/component/Toast/Toast';
import { useSplitLayout } from '@app/component/split-layout/layout';

export function EmailCompose() {
  const hasPaidAccess = useHasPaidAccess();
  const { showPaywall } = usePaywallState();

  const [subject, setSubject] = createSignal<string>('');

  const [linkError, setLinkError] = createSignal<string | null>(null);

  const [link] = createResource(async () => {
    const maybeLinks = await emailClient.getLinks();
    if (isErr(maybeLinks)) {
      setLinkError('Could not find linked email account.');
      return;
    }
    const [, { links }] = maybeLinks;
    const [link] = links;
    if (link) {
      return link;
    } else {
      setLinkError('Could not find linked email account.');
    }
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

  const sendEmailMutation = useMutation(() => ({
    async mutationFn(contents: {
      body: { text: string; html: string; raw: string; attachments?: [] };
    }) {
      const _link = link();

      if (!selectedRecipients().length) {
        const e = 'Please select at least one recipient';
        throw new Error(e);
      }

      if (!contents.body.raw.trim()) {
        const e = 'Please enter a message';
        throw new Error(e);
      }

      if (!subject()?.trim()) {
        const e = 'Please enter a subject';
        throw new Error(e);
      }
      if (!_link) {
        const e = 'Unable to find linked email account';
        throw new Error(e);
      }

      const result = await emailClient.sendMessage({
        message: {
          link_id: _link.id, // For new emails
          to: convertToContactInfoArray(selectedRecipients()),
          cc:
            ccRecipients && ccRecipients.length > 0
              ? convertToContactInfoArray(ccRecipients())
              : [],
          bcc:
            bccRecipients && bccRecipients.length > 0
              ? convertToContactInfoArray(bccRecipients())
              : [],
          subject: subject(),
          body_text: contents.body.text,
          body_html: contents.body.html,
          body_macro: contents.body.raw,
          attachments: [],
        },
      });

      if (isErr(result)) {
        const e = 'Failed to send email';
        throw new Error(e);
      }

      return result[1];
    },
    mutationKey: ['compose-email'],
    onSuccess(data) {
      toast.success('Email sent');
      if (data.message.thread_db_id) {
        replaceSplit({ type: 'email', id: data.message.thread_db_id }, true);
      }
    },
  }));

  const onSubmit = (data: ComposeInputData) => {
    sendEmailMutation.mutate(data);
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
          <Match when={linkError()}>
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
          class="macro-message-width mx-auto w-full max-h-full my-12 overflow-hidden"
          classList={{
            'pointer-events-none opacity-50': Boolean(linkError()),
          }}
        >
          <ClippedPanel tl tr>
            <div
              class="w-full p-4 bg-input max-h-full overflow-hidden flex flex-col min-h-0"
              classList={{
                'pointer-events-none opacity-50': Boolean(linkError()),
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
                        disabled={!!linkError()}
                      >
                        + Cc
                      </button>
                    </Show>
                    <Show when={!showBcc()}>
                      <button
                        type="button"
                        class="text-sm text-secondary-text hover:text-primary-text hover:bg-hover"
                        onClick={() => setShowBcc(true)}
                        disabled={!!linkError()}
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
                        focusOnMount={!linkError()}
                        hideBorder
                        noBrackets
                      />
                    </div>
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
                        disabled={!!linkError()}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div
                class="w-full h-full pb-2 flex flex-col min-h-0 overflow-hidden mt-4"
                classList={{
                  'pointer-events-none opacity-50': Boolean(linkError()),
                }}
              >
                <ComposeEmailInput
                  onSubmit={onSubmit}
                  isSubmitting={sendEmailMutation.isPending}
                />
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
