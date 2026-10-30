import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import { ActionDialogShell, Button, Checkbox, Dialog, Input } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import {
  type Campaign,
  MAX_ENROLLMENT_BATCH,
  type MarketingContact,
  mergeContacts,
  normalizeEmail,
} from '../core/model';
import { errorMessage } from './error-message';

const SURFACE = 'email-marketing.enroll';

/** Half an hour from now, as a `datetime-local` value in local time. */
function defaultStart() {
  const date = new Date(Date.now() + 30 * 60_000);
  date.setSeconds(0, 0);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export function EnrollmentDialog(props: {
  campaign: Campaign;
  contacts: MarketingContact[];
  enrolledEmails: string[];
  isUnsubscribed: (email: string) => boolean;
  busy: boolean;
  error: unknown;
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
  onEnroll: (contacts: MarketingContact[], startAt: Date) => Promise<boolean>;
  onSearchCrm: (query: string) => Promise<MarketingContact[]>;
}) {
  const [search, setSearch] = createSignal('');
  // Normalized emails, so a CRM case variant still matches a local contact.
  const [selected, setSelected] = createSignal<string[]>([]);
  const [start, setStart] = createSignal(defaultStart());
  const [consent, setConsent] = createSignal(false);
  const [remote, setRemote] = createSignal<MarketingContact[]>([]);
  const [searchError, setSearchError] = createSignal<unknown>();
  const [searching, setSearching] = createSignal(false);
  // CRM results fill in what local contacts lack, never replace them.
  const all = () => mergeContacts([...remote(), ...props.contacts]);
  const filtered = () =>
    all().filter((contact) =>
      `${contact.name} ${contact.email}`
        .toLowerCase()
        .includes(search().toLowerCase())
    );
  const isSelected = (email: string) =>
    selected().includes(normalizeEmail(email));
  const blocked = (email: string) =>
    props.enrolledEmails.includes(normalizeEmail(email)) ||
    props.isUnsubscribed(email);
  const chosen = () =>
    all().filter(
      (contact) => isSelected(contact.email) && !blocked(contact.email)
    );
  const searchCrm = async () => {
    setSearching(true);
    setSearchError(undefined);
    try {
      setRemote(await props.onSearchCrm(search()));
    } catch (cause) {
      setSearchError(cause);
    } finally {
      setSearching(false);
    }
  };
  const enroll = async () => {
    if (await props.onEnroll(chosen(), new Date(start()))) props.onClose();
  };
  const contactState = (contact: MarketingContact) =>
    props.enrolledEmails.includes(normalizeEmail(contact.email))
      ? t('emailMarketing.alreadyEnrolled')
      : props.isUnsubscribed(contact.email)
        ? t('emailMarketing.unsubscribed')
        : contact.crmContactId
          ? t('emailMarketing.crmContact')
          : t('emailMarketing.contact');
  return (
    <Dialog
      open
      position="center"
      class="w-[min(620px,calc(100vw-16px))]"
      onOpenChange={(open) => {
        if (!open && !props.busy) props.onClose();
      }}
      onEscapeKeyDown={(event) => {
        if (props.busy) event.preventDefault();
      }}
      onCloseAutoFocus={props.onCloseAutoFocus}
    >
      <ActionDialogShell class="max-h-[88vh]">
        <ActionDialogShell.Body class="space-y-4">
          <ActionDialogShell.Header>
            <ActionDialogShell.Title>
              {t('emailMarketing.enrollContacts')}
            </ActionDialogShell.Title>
            <ActionDialogShell.Description class="truncate">
              {t('emailMarketing.enrollInto', { name: props.campaign.name })}
            </ActionDialogShell.Description>
          </ActionDialogShell.Header>
          {/* The search comes first, so it takes focus when the dialog opens. */}
          <form
            class="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!searching() && !props.busy)
                fireAndForget(searchCrm(), SURFACE);
            }}
          >
            <Input
              aria-label={t('emailMarketing.searchContacts')}
              placeholder={t('emailMarketing.searchContactsPlaceholder')}
              value={search()}
              onInput={(event) => {
                setSearch(event.currentTarget.value);
                setSearchError(undefined);
              }}
            />
            <Button
              type="submit"
              variant="secondary"
              disabled={searching() || props.busy}
              loading={searching()}
            >
              {t('emailMarketing.searchCrm')}
            </Button>
          </form>
          <Show when={searchError()}>
            {(cause) => (
              <p class="text-xs text-failure" role="alert">
                {errorMessage(cause())}
              </p>
            )}
          </Show>
          <div class="max-h-72 min-h-28 overflow-y-auto rounded-lg border border-edge-muted">
            <Show
              when={filtered().length}
              fallback={
                <p class="p-5 text-sm text-ink-muted">
                  {t('emailMarketing.noMatchingContacts')}
                </p>
              }
            >
              <For each={filtered()}>
                {(contact) => (
                  <Checkbox
                    class="flex w-full items-center gap-3 border-b border-edge-muted px-4 py-3 last:border-0"
                    checked={isSelected(contact.email)}
                    disabled={
                      props.busy ||
                      blocked(contact.email) ||
                      (!isSelected(contact.email) &&
                        selected().length >= MAX_ENROLLMENT_BATCH)
                    }
                    onChange={(checked: boolean) => {
                      const email = normalizeEmail(contact.email);
                      setSelected((before) =>
                        checked
                          ? [...new Set([...before, email])]
                          : before.filter((item) => item !== email)
                      );
                    }}
                  >
                    <Checkbox.Control />
                    <Checkbox.Label class="flex min-w-0 flex-1 items-center gap-3">
                      <span class="min-w-0 flex-1">
                        <span class="block truncate text-sm font-medium">
                          {contact.name || contact.email}
                        </span>
                        <span class="block truncate text-xs text-ink-muted">
                          {contact.email}
                        </span>
                      </span>
                      <span class="shrink-0 text-xs text-ink-muted">
                        {contactState(contact)}
                      </span>
                    </Checkbox.Label>
                  </Checkbox>
                )}
              </For>
            </Show>
          </div>
          <label class="block space-y-1 text-xs font-medium">
            {t('emailMarketing.startSending')}
            <Input
              aria-label={t('emailMarketing.startTime')}
              type="datetime-local"
              value={start()}
              disabled={props.busy}
              onInput={(event) => setStart(event.currentTarget.value)}
            />
          </label>
          <p class="text-xs text-ink-muted">
            {t('emailMarketing.startHint', {
              count: props.campaign.steps.length,
            })}
          </p>
          <Checkbox
            class="flex items-start gap-2 text-xs text-ink-muted"
            checked={consent()}
            disabled={props.busy}
            onChange={(checked: boolean) => setConsent(checked)}
          >
            <Checkbox.Control />
            <Checkbox.Label>{t('emailMarketing.consent')}</Checkbox.Label>
          </Checkbox>
          <Show when={props.error}>
            {(cause) => (
              <p class="whitespace-pre-line text-xs text-failure" role="alert">
                {errorMessage(cause())}
              </p>
            )}
          </Show>
        </ActionDialogShell.Body>
        <ActionDialogShell.Footer class="items-center">
          <span class="mr-auto text-xs text-ink-muted">
            {t('emailMarketing.selectedCount', {
              count: chosen().length,
              max: MAX_ENROLLMENT_BATCH,
            })}
          </span>
          <Button
            type="button"
            variant="ghost"
            disabled={props.busy}
            onClick={() => props.onClose()}
          >
            {t('emailMarketing.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!chosen().length || !consent() || props.busy}
            loading={props.busy}
            onClick={enroll}
          >
            {t('emailMarketing.enrollCount', { count: chosen().length })}
          </Button>
        </ActionDialogShell.Footer>
      </ActionDialogShell>
    </Dialog>
  );
}
