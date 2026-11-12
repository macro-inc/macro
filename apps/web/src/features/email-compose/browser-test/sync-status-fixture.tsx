import { createSignal, For } from 'solid-js';
import { DraftSyncStatus } from '../components/draft-sync-status';
import type { EmailDraftStorage } from '../context/compose-capabilities';
import type { LocalDraft } from '../core/local-draft';
import { createDraftSyncStatus } from '../primitives/draft-sync-status';

type Availability = ReturnType<
  NonNullable<EmailDraftStorage['syncAvailability']>
>;

const STATUSES: LocalDraft['status'][] = [
  'dirty',
  'queued',
  'synced',
  'deleting',
  'delete-failed',
  'failed',
  'unconfirmed',
];
const AVAILABILITY: Availability[] = [
  'ready',
  'unavailable',
  'recovering',
  'recovery-required',
];

/**
 * The composer's sync banner over a working copy the page controls: the real
 * status primitive and component, with no queue or server behind them.
 */
export function SyncStatusFixture() {
  const [status, setStatus] = createSignal<LocalDraft['status']>('synced');
  const [availability, setAvailability] = createSignal<Availability>('ready');
  const [offline, setOffline] = createSignal(false);
  const [retries, setRetries] = createSignal(0);
  let changed = () => {};
  const local = (): LocalDraft => ({
    key: 'draft',
    draftId: 'draft',
    accountId: 'owner',
    generation: 'generation',
    revision: 2,
    acknowledgedRevision: status() === 'synced' ? 2 : 1,
    status: status(),
    updatedAt: 1,
    content: { subject: 'Review' },
    attachments: [],
  });
  const settle = () => {
    // A retry succeeds here: the copy goes back to the server's state.
    setRetries((count) => count + 1);
    setStatus('synced');
    changed();
  };
  const sync = createDraftSyncStatus({
    drafts: {
      saveLocalDraft: async () => local(),
      readDraft: async () => ({ local: local(), persistence: 'queued' }),
      watchDrafts: (callback: () => void) => {
        changed = callback;
        return () => {
          changed = () => {};
        };
      },
      syncAvailability: availability,
      recoverSynchronization: async () => {},
    } as unknown as EmailDraftStorage,
    connectivity: { looksOffline: offline },
    draftId: () => 'draft',
    localSaveState: () => 'saved',
    retry: async () => settle(),
    discard: async () => settle(),
  });
  return (
    <main class="min-h-screen bg-surface p-4 text-ink">
      <section
        aria-label="Composer"
        class="mx-auto max-w-[520px] rounded-xl border border-edge-muted"
      >
        <DraftSyncStatus
          state={sync.state()}
          busy={sync.busy()}
          error={sync.error()}
          onRetry={sync.retry}
          onReload={() => setRetries((count) => count + 1)}
          onKeepEditing={sync.keepEditing}
        />
        <p class="p-3 text-sm">Message body</p>
      </section>
      <fieldset class="mt-6 flex flex-wrap gap-2 text-xs">
        <legend>Working copy</legend>
        <For each={STATUSES}>
          {(next) => (
            <button
              type="button"
              class="rounded border border-edge-muted px-2 py-1"
              onClick={() => {
                setStatus(next);
                changed();
              }}
            >
              copy {next}
            </button>
          )}
        </For>
      </fieldset>
      <fieldset class="mt-2 flex flex-wrap gap-2 text-xs">
        <legend>Local storage</legend>
        <For each={AVAILABILITY}>
          {(next) => (
            <button
              type="button"
              class="rounded border border-edge-muted px-2 py-1"
              onClick={() => setAvailability(next)}
            >
              storage {next}
            </button>
          )}
        </For>
        <button
          type="button"
          class="rounded border border-edge-muted px-2 py-1"
          onClick={() => setOffline((value) => !value)}
        >
          toggle offline
        </button>
      </fieldset>
      <output data-testid="retries">{retries()}</output>
    </main>
  );
}
