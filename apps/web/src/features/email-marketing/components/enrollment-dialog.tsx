import { Dialog } from '@kobalte/core/dialog';
import { createSignal, For, Show } from 'solid-js';
import type { Campaign, MarketingContact } from '../core/model';
import { normalizeEmail } from '../core/model';

export const primaryButton =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-page hover:opacity-85 disabled:opacity-40';
export const secondaryButton =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-edge-muted bg-page px-3 py-2 text-sm font-medium hover:bg-panel disabled:opacity-40';
export const inputClass =
  'w-full rounded-lg border border-edge-muted bg-input px-3 py-2 text-sm outline-none focus:border-accent';

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
  const already = (email: string) =>
    props.enrolledEmails.includes(normalizeEmail(email));
  const chosen = () =>
    all().filter((contact) => selected().includes(contact.email));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !props.busy) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-100 bg-ink/20 backdrop-blur-sm" />
        <Dialog.Content
          class="fixed left-1/2 top-1/2 z-101 flex max-h-[88vh] w-[min(620px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-edge-muted bg-page p-6 shadow-xl"
          onEscapeKeyDown={(event) => {
            if (props.busy) event.preventDefault();
          }}
        >
          <div class="flex items-start justify-between">
            <div>
              <Dialog.Title class="text-lg font-semibold">
                Enroll contacts
              </Dialog.Title>
              <Dialog.Description class="mt-1 text-sm text-ink-muted">
                Add people to {props.campaign.name}.
              </Dialog.Description>
            </div>
            <button
              type="button"
              aria-label="Close enrollment"
              class="p-1 text-ink-muted"
              disabled={props.busy}
              onClick={props.onClose}
            >
              ✕
            </button>
          </div>
          <div class="mt-5 flex gap-2">
            <input
              aria-label="Search enrollment contacts"
              class={inputClass}
              placeholder="Search contacts by name or email"
              value={search()}
              onInput={(event) => {
                setSearch(event.currentTarget.value);
                setSearchError('');
              }}
            />
            <button
              type="button"
              class={`${secondaryButton} shrink-0`}
              disabled={searching() || props.busy}
              onClick={async () => {
                setSearching(true);
                setSearchError('');
                try {
                  setRemote(await props.onSearchCrm(search()));
                } catch (cause) {
                  setSearchError(
                    cause instanceof Error ? cause.message : String(cause)
                  );
                } finally {
                  setSearching(false);
                }
              }}
            >
              {searching() ? 'Searching…' : 'Search CRM'}
            </button>
          </div>
          <Show when={searchError()}>
            <p class="mt-2 text-xs text-failure" role="alert">
              {searchError()}
            </p>
          </Show>
          <div class="mt-3 min-h-28 flex-1 overflow-y-auto rounded-lg border border-edge-muted">
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
                        (!selected().includes(contact.email) &&
                          selected().length >= 50)
                      }
                      checked={selected().includes(contact.email)}
                      onChange={(event) =>
                        setSelected((before) =>
                          event.currentTarget.checked
                            ? [...before, contact.email]
                            : before.filter((email) => email !== contact.email)
                        )
                      }
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
          <label class="mt-4 space-y-1 text-xs font-medium">
            Start sending <span class="text-ink-muted">your local time</span>
            <input
              aria-label="Sequence start time"
              class={inputClass}
              type="datetime-local"
              value={start()}
              disabled={props.busy}
              onInput={(event) => setStart(event.currentTarget.value)}
            />
          </label>
          <p class="mt-2 text-xs text-ink-muted">
            Starts at least 10 minutes from now. Each contact receives{' '}
            {props.campaign.steps.length} emails following the sequence delays.
          </p>
          <label class="mt-4 flex items-start gap-2 text-xs text-ink-muted">
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
            <p class="mt-3 text-xs text-failure" role="alert">
              {props.error}
            </p>
          </Show>
          <div class="mt-5 flex items-center justify-between border-t border-edge-muted pt-4">
            <span class="text-xs text-ink-muted">
              {chosen().length} selected · up to 50 at a time
            </span>
            <button
              type="button"
              class={primaryButton}
              disabled={!chosen().length || !consent() || props.busy}
              onClick={async () => {
                if (await props.onEnroll(chosen(), new Date(start())))
                  props.onClose();
              }}
            >
              {props.busy
                ? 'Scheduling…'
                : `Enroll ${chosen().length || ''} contact${chosen().length === 1 ? '' : 's'}`}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
