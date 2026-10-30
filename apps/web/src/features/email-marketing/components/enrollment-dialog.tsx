import X from '@icon/system/regular/x.svg';
import { ActionDialogShell, Button, Dialog, Input } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import type { Campaign, MarketingContact } from '../core/model';
import { normalizeEmail } from '../core/model';

/** @deprecated Kept only for the browser-test fixture; use `@ui` Button. */
export const primaryButton =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-page hover:opacity-85 disabled:opacity-40';
/** @deprecated Kept only for the browser-test fixture; use `@ui` Button. */
export const secondaryButton =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-edge-muted bg-page px-3 py-2 text-sm font-medium hover:bg-panel disabled:opacity-40';

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
  busy: boolean;
  error: string;
  onClose: () => void;
  onEnroll: (contacts: MarketingContact[], startAt: Date) => Promise<boolean>;
  onSearchCrm: (query: string) => Promise<MarketingContact[]>;
}) {
  const [search, setSearch] = createSignal('');
  // Normalized emails, so a CRM case variant still matches a local contact.
  const [selected, setSelected] = createSignal<string[]>([]);
  const [start, setStart] = createSignal(defaultStart());
  const [consent, setConsent] = createSignal(false);
  const [remote, setRemote] = createSignal<MarketingContact[]>([]);
  const [searchError, setSearchError] = createSignal('');
  const [searching, setSearching] = createSignal(false);
  const all = () => [
    ...new Map(
      [...props.contacts, ...remote()].map((contact) => [
        normalizeEmail(contact.email),
        contact,
      ])
    ).values(),
  ];
  const filtered = () =>
    all().filter((contact) =>
      `${contact.name} ${contact.email}`
        .toLowerCase()
        .includes(search().toLowerCase())
    );
  const isSelected = (email: string) =>
    selected().includes(normalizeEmail(email));
  const already = (email: string) =>
    props.enrolledEmails.map(normalizeEmail).includes(normalizeEmail(email));
  const chosen = () =>
    all().filter(
      (contact) => isSelected(contact.email) && !already(contact.email)
    );
  const searchCrm = async () => {
    setSearching(true);
    setSearchError('');
    try {
      setRemote(await props.onSearchCrm(search()));
    } catch (cause) {
      setSearchError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSearching(false);
    }
  };
  const enroll = async () => {
    if (await props.onEnroll(chosen(), new Date(start()))) props.onClose();
  };
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
    >
      <ActionDialogShell class="max-h-[88vh]">
        <div class="flex shrink-0 items-start justify-between gap-3 border-b border-edge-divider px-5 py-4">
          <div>
            <ActionDialogShell.Title>Enroll contacts</ActionDialogShell.Title>
            <ActionDialogShell.Description class="mt-1">
              Add people to {props.campaign.name}.
            </ActionDialogShell.Description>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close enrollment"
            disabled={props.busy}
            onClick={() => props.onClose()}
          >
            <X aria-hidden="true" class="size-4" />
          </Button>
        </div>
        <ActionDialogShell.Body class="space-y-4">
          <div class="flex gap-2">
            <Input
              aria-label="Search enrollment contacts"
              placeholder="Search contacts by name or email"
              value={search()}
              onInput={(event) => {
                setSearch(event.currentTarget.value);
                setSearchError('');
              }}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={searching() || props.busy}
              onClick={searchCrm}
            >
              {searching() ? 'Searching…' : 'Search CRM'}
            </Button>
          </div>
          <Show when={searchError()}>
            <p class="text-xs text-failure" role="alert">
              {searchError()}
            </p>
          </Show>
          <div class="max-h-72 min-h-28 overflow-y-auto rounded-lg border border-edge-muted">
            <Show
              when={filtered().length}
              fallback={
                <p class="p-5 text-sm text-ink-muted">
                  No matching contacts. Try searching CRM.
                </p>
              }
            >
              <For each={filtered()}>
                {(contact) => (
                  <label
                    class="flex items-center gap-3 border-b border-edge-muted px-4 py-3 last:border-0"
                    classList={{ 'opacity-50': already(contact.email) }}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Enroll ${contact.email}`}
                      disabled={
                        props.busy ||
                        already(contact.email) ||
                        (!isSelected(contact.email) && selected().length >= 50)
                      }
                      checked={isSelected(contact.email)}
                      onChange={(event) => {
                        const email = normalizeEmail(contact.email);
                        const checked = event.currentTarget.checked;
                        setSelected((before) =>
                          checked
                            ? [...new Set([...before, email])]
                            : before.filter((item) => item !== email)
                        );
                      }}
                    />
                    <span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-panel text-xs font-medium text-ink-muted">
                      {(contact.name || contact.email)
                        .slice(0, 2)
                        .toUpperCase()}
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-sm font-medium">
                        {contact.name || contact.email}
                      </span>
                      <span class="block truncate text-xs text-ink-muted">
                        {contact.email}
                      </span>
                    </span>
                    <span class="text-xs text-ink-muted">
                      {already(contact.email)
                        ? 'Already enrolled'
                        : contact.crmContactId
                          ? 'CRM contact'
                          : 'Contact'}
                    </span>
                  </label>
                )}
              </For>
            </Show>
          </div>
          <label class="block space-y-1 text-xs font-medium">
            Start sending <span class="text-ink-muted">your local time</span>
            <Input
              aria-label="Sequence start time"
              type="datetime-local"
              value={start()}
              disabled={props.busy}
              onInput={(event) => setStart(event.currentTarget.value)}
            />
          </label>
          <p class="text-xs text-ink-muted">
            Starts at least 10 minutes from now. Each contact receives{' '}
            {props.campaign.steps.length} emails following the sequence delays.
          </p>
          <label class="flex items-start gap-2 text-xs text-ink-muted">
            <input
              type="checkbox"
              aria-label="Confirm permission to email"
              checked={consent()}
              disabled={props.busy}
              onChange={(event) => setConsent(event.currentTarget.checked)}
            />
            <span>
              I have permission to email these contacts and will handle replies
              and unsubscribe requests.
            </span>
          </label>
          <Show when={props.error}>
            <p class="text-xs text-failure" role="alert">
              {props.error}
            </p>
          </Show>
        </ActionDialogShell.Body>
        <ActionDialogShell.Footer class="justify-between">
          <span class="text-xs text-ink-muted">
            {chosen().length} selected · up to 50 at a time
          </span>
          <Button
            type="button"
            variant="primary"
            disabled={!chosen().length || !consent() || props.busy}
            onClick={enroll}
          >
            {props.busy
              ? 'Scheduling…'
              : `Enroll ${chosen().length || ''} contact${chosen().length === 1 ? '' : 's'}`}
          </Button>
        </ActionDialogShell.Footer>
      </ActionDialogShell>
    </Dialog>
  );
}
