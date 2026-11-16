import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { DraftSyncStatus } from '../components/draft-sync-status';
import type { LocalDraft } from '../core/local-draft';
import { createDraftSyncStatus } from '../primitives/draft-sync-status';
import { createComposeContext } from '../tests/capabilities';

afterEach(cleanup);

const draft: LocalDraft = {
  key: 'draft',
  accountId: 'owner',
  generation: 'generation',
  draftId: 'draft',
  revision: 1,
  acknowledgedRevision: 0,
  content: { subject: 'Keep this' },
  attachments: [],
  status: 'failed',
  updatedAt: 1,
};

/** The banner as the composer views mount it, over a working copy the test controls. */
function Banner(props: { status: LocalDraft['status']; onRetried(): void }) {
  const context = createComposeContext();
  const [local, setLocal] = createSignal<LocalDraft>({
    ...draft,
    status: props.status,
  });
  let changed = () => {};
  context.drafts.saveLocalDraft = vi.fn();
  context.drafts.readDraft = vi.fn(async () => ({
    local: local(),
    persistence: 'queued' as const,
  }));
  context.drafts.watchDrafts = (callback) => {
    changed = callback;
    return () => {};
  };
  // The retried write reaches the server: the store announces a synced copy.
  const recovered = async () => {
    props.onRetried();
    setLocal({ ...draft, status: 'synced', acknowledgedRevision: 1 });
    changed();
  };
  const sync = createDraftSyncStatus({
    drafts: context.drafts,
    connectivity: context.connectivity,
    draftId: () => 'draft',
    localSaveState: () => 'saved',
    retry: recovered,
    discard: recovered,
  });
  return (
    <DraftSyncStatus
      state={sync.state()}
      busy={sync.busy()}
      error={sync.error()}
      onRetry={sync.retry}
      onReload={() => {}}
      onKeepEditing={sync.keepEditing}
    />
  );
}

it.each([
  ['failed', 'Retry', 'The server could not save this draft.'],
  ['delete-failed', 'Retry discard', 'Discard could not be confirmed.'],
] as const)(
  'leaves the screen once a %s copy recovers through its own retry',
  async (status, label, detail) => {
    const retried = vi.fn();
    render(() => <Banner status={status} onRetried={retried} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(detail);

    fireEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() => expect(retried).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.queryByRole('button', { name: label })).toBeNull();
  }
);
