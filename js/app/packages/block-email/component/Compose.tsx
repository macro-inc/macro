import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import {
  SplitHeaderBadge,
  StaticSplitLabel,
} from '@app/component/split-layout/components/SplitLabel';
import { connectEmail } from '@app/signal/onboarding/email-link';
import { useHasPaidAccess } from '@core/auth';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { TextButton } from '@core/component/TextButton';
import { usePaywallState } from '@core/constant/PaywallState';
import { fileDrop } from '@core/directive/fileDrop';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import { useDisplayName, type WithCustomUserInput } from '@core/user';
import { isErr } from '@core/util/maybeResult';
import Caution from '@icon/regular/warning.svg';
import { emailClient } from '@service-email/client';
import type { Link as EmailAccountLink } from '@service-email/generated/schemas';
import {
  createMemo,
  createSignal,
  Match,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { ComposeEmailInput } from './ComposeEmailInput';

false && fileDrop;

export function EmailCompose() {
  const hasPaidAccess = useHasPaidAccess();
  const { showPaywall } = usePaywallState();

  const [subject, setSubject] = createSignal<string>('');

  const [emailInputAttachmentsStore, setEmailInputAttachmentsStore] =
    createStore<Record<string, any[]>>({});

  const [link, setLink] = createSignal<EmailAccountLink | null>(null);
  const [linkError, setLinkError] = createSignal<string | null>(null);
  onMount(async () => {
    const maybeLinks = await emailClient.getLinks();
    if (isErr(maybeLinks)) {
      setLinkError('Could not find linked email account.');
      return;
    }
    const [, { links }] = maybeLinks;
    const [link] = links;
    if (link) {
      setLink(link);
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
      <div class="relative flex flex-col w-full h-full panel">
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
          class="pt-2 h-full w-full overflow-y-auto px-4 flex flex-col"
          classList={{
            'pointer-events-none opacity-50': Boolean(linkError()),
          }}
        >
          <div class="macro-message-width mx-auto pb-1 w-full">
            <div class="mb-4 mt-12 h-6 flex items-center justify-between">
              <Show when={link()}>
                {(link) => (
                  <div class="text-xs text-ink-extra-muted/50">
                    from {link().email_address}
                  </div>
                )}
              </Show>
              <div class="flex gap-2">
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

            <div class="flex items-center gap-2 focus-within:bracket-offset-2 border-edge-muted border-b">
              <div class="text-sm w-8 shrink-0 text-ink-placeholder/70">To</div>
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
              <div class="flex items-center gap-2 focus-within:bracket-offset-2 border-edge-muted border-b">
                <div class="text-sm w-8 shrink-0 text-ink-placeholder/70">
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
              <div class="mb-2 flex items-center gap-2 border-edge-muted border-b focus-within:bracket-offset-2">
                <div class="text-sm w-8 shrink-0 text-ink-placeholder/70">
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

            <input
              type="text"
              value={subject()}
              placeholder="Subject"
              class="text-xl mt-4 font-medium mb-6 bg-transparent border-none outline-none w-full resize-none appearance-none focus:ring-0"
              style="box-shadow: none;"
              onInput={(e) => {
                setSubject(e.currentTarget.value);
              }}
              disabled={!!linkError()}
            />
          </div>
          <div
            class="shrink-0 w-full pb-2 grow"
            classList={{
              'pointer-events-none opacity-50': Boolean(linkError()),
            }}
          >
            <div class="mx-auto w-full h-full macro-message-width">
              <ComposeEmailInput
                selectedRecipients={selectedRecipients}
                ccRecipients={ccRecipients}
                bccRecipients={bccRecipients}
                subject={subject}
                link={link()}
                inputAttachments={{
                  store: emailInputAttachmentsStore,
                  setStore: setEmailInputAttachmentsStore,
                  key: 'draft',
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
