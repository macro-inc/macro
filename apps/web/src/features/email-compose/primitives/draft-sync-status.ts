import { deferredGate } from '@core/util/debounce';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  type Accessor,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
} from 'solid-js';
import type {
  EmailConnectivity,
  EmailDraftStorage,
} from '../context/compose-capabilities';
import type { DraftSyncViewState } from '../core/local-draft';

// Local storage that restarts is back within seconds nearly every time and
// retries itself, so the composer says nothing until it has clearly stalled.
const SYNC_STALL_NOTICE_MS = 15_000;

/** Recovery reads only metadata; file blobs are restored once when opening a draft. */
export function createDraftSyncStatus(options: {
  drafts: EmailDraftStorage;
  connectivity: EmailConnectivity;
  draftId: Accessor<string | undefined>;
  localSaveState: Accessor<'saving' | 'saved' | 'failed'>;
  retry(): Promise<unknown>;
  discard(): Promise<unknown>;
}) {
  const [busy, setBusy] = createSignal(false);
  const [actionError, setActionError] = createSignal<string>();
  const [saved, { refetch }] = createResource(
    () => options.drafts.readDraft && options.draftId(),
    async (id) => await options.drafts.readDraft!(id, { attachments: false })
  );
  createEffect(() => {
    const unsubscribe = options.drafts.watchDrafts?.(() => {
      fireAndForget(refetch(), 'email-compose');
    });
    onCleanup(() => unsubscribe?.());
  });
  const local = () =>
    saved.state === 'ready' || saved.state === 'refreshing'
      ? saved.latest?.local
      : undefined;
  // A discard still on its way to the server is not a failure.
  const discardFailed = () => local()?.status === 'delete-failed';
  const availability = () => options.drafts.syncAvailability?.() ?? 'ready';
  // One restart moves between these two states with every attempt.
  const restarting = createMemo(
    () => availability() === 'unavailable' || availability() === 'recovering'
  );
  const stalled = deferredGate(restarting, SYNC_STALL_NOTICE_MS);
  // Saving is silent. Edits that cannot reach the server yet wait on this
  // device, which is worth saying only offline or once a restart has stalled.
  const waitingState = (): DraftSyncViewState | undefined => {
    const draft = local();
    if (!draft || draft.acknowledgedRevision >= draft.revision) return;
    if (options.connectivity.looksOffline())
      return {
        message: 'Saved on this device; waiting to sync',
        detail: 'Changes stay on this device until you are back online.',
        failed: false,
        canKeepEditing: false,
      };

    if (!restarting() || !stalled()) return;
    return {
      message: 'Saved on this device; waiting to sync',
      detail:
        'Changes stay on this device until draft synchronization resumes.',
      failed: false,
      action: availability() === 'unavailable' ? 'retry' : undefined,
      canKeepEditing: false,
    };
  };
  const state = createMemo<DraftSyncViewState | undefined>(() => {
    if (!options.drafts.saveLocalDraft || !options.draftId()) return;
    const disk = options.localSaveState();
    const draft = local();
    if (saved.error)
      return {
        message: 'Unable to read local draft status.',
        detail: 'Retry to check the saved draft.',
        failed: true,
        action: 'retry',
        canKeepEditing: false,
      };
    const failed =
      disk === 'failed' ||
      ['failed', 'unconfirmed', 'delete-failed'].includes(draft?.status ?? '');
    // Only a reload brings this storage back, so the user has to act.
    if (disk !== 'failed' && availability() === 'recovery-required') {
      return {
        message: draft
          ? 'Saved on this device; waiting to sync'
          : 'Draft synchronization unavailable',
        detail:
          'Queued changes are preserved. Update or reload Macro to recover local storage.',
        failed: true,
        action: 'reload',
        canKeepEditing: false,
      };
    }
    if (!failed) return waitingState();
    return {
      message:
        disk === 'failed'
          ? 'Changes could not be saved on this device'
          : 'Draft could not be synced',
      detail:
        disk === 'failed'
          ? 'Keep this editor open until saving succeeds.'
          : discardFailed()
            ? 'Discard could not be confirmed.'
            : draft?.status === 'unconfirmed'
              ? 'The last save could not be confirmed.'
              : draft?.status === 'failed'
                ? 'The server could not save this draft.'
                : undefined,
      failed,
      action: discardFailed() ? 'retry-discard' : 'retry',
      canKeepEditing: discardFailed(),
    };
  });
  const run = async (action: () => Promise<unknown>) => {
    if (busy()) return;
    setBusy(true);
    setActionError(undefined);
    try {
      await options.drafts.recoverSynchronization?.();
      await action();
      await refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return {
    state,
    busy,
    error: () =>
      actionError() ??
      (saved.error
        ? 'Unable to read local draft status. Retry to check the saved draft.'
        : undefined),
    retry: () => {
      fireAndForget(
        run(
          saved.error
            ? async () => {
                await refetch();
              }
            : discardFailed()
              ? options.discard
              : options.retry
        ),
        'email-compose'
      );
    },
    keepEditing: () => {
      fireAndForget(run(options.retry), 'email-compose');
    },
  };
}
