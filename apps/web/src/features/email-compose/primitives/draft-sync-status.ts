import {
  type Accessor,
  createEffect,
  createResource,
  createSignal,
  onCleanup,
} from 'solid-js';
import type { EmailDraftStorage } from '../context/compose-capabilities';
import type { DraftSyncViewState } from '../core/local-draft';

/** Recovery reads only metadata; file blobs are restored once when opening a draft. */
export function createDraftSyncStatus(options: {
  drafts: EmailDraftStorage;
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
      void refetch();
    });
    onCleanup(() => unsubscribe?.());
  });
  const local = () =>
    saved.state === 'ready' || saved.state === 'refreshing'
      ? saved.latest?.local
      : undefined;
  const deletePending = () =>
    local()?.status === 'delete-failed' ||
    (local()?.status === 'deleting' &&
      (!local()?.queuedAttemptId ||
        local()?.queuedAttemptId !== local()?.latestAttemptId));
  const state = (): DraftSyncViewState | undefined => {
    if (!options.drafts.saveLocalDraft) return;
    const disk = options.localSaveState();
    const draft = local();
    if (saved.error && disk === 'saved')
      return {
        message: 'Unable to read local draft status.',
        detail: 'Reopen the draft to try again.',
        failed: true,
        canDiscard: false,
        canKeepEditing: false,
      };
    if (disk === 'saved' && (!draft || draft.status === 'synced')) return;
    const failed =
      disk === 'failed' ||
      ['failed', 'unconfirmed', 'delete-failed'].includes(draft?.status ?? '');
    const recoverable = failed || draft?.status === 'dirty' || deletePending();
    return {
      message:
        disk === 'saving'
          ? 'Saving on this device…'
          : disk === 'failed'
            ? 'Changes could not be saved on this device'
            : `Saved on this device · ${draft?.status === 'queued' ? 'Syncing' : 'Not synced'}`,
      detail:
        disk === 'failed'
          ? 'Keep this editor open until saving succeeds.'
          : deletePending()
            ? 'Discard could not be confirmed.'
            : draft?.status === 'unconfirmed'
              ? 'The last save could not be confirmed.'
              : draft?.status === 'failed'
                ? 'The server could not save this draft.'
                : undefined,
      failed,
      action: recoverable
        ? deletePending()
          ? 'retry-discard'
          : draft?.status === 'dirty'
            ? 'save'
            : 'retry'
        : undefined,
      canDiscard: recoverable && !deletePending(),
      canKeepEditing: deletePending(),
    };
  };
  const run = async (action: () => Promise<unknown>) => {
    if (busy()) return;
    setBusy(true);
    setActionError(undefined);
    try {
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
        ? 'Unable to read local draft status. Reopen the draft to try again.'
        : undefined),
    retry: () => {
      void run(deletePending() ? options.discard : options.retry);
    },
    discard: () => {
      void run(options.discard);
    },
    keepEditing: () => {
      void run(options.retry);
    },
  };
}
