import {
  type Accessor,
  createEffect,
  createMemo,
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
  acknowledgeSaved: Accessor<boolean>;
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
  const state = createMemo<DraftSyncViewState | undefined>((previous) => {
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
      ['failed', 'unconfirmed', 'delete-failed'].includes(
        draft?.status ?? ''
      ) ||
      deletePending();
    // Only a newly persisted version restarts the brief acknowledgement.
    // Queue notifications and identity adoption do not count as another save.
    if (!failed) {
      if (!draft && (disk === 'saving' || saved.loading))
        return previous && { ...previous, savedVersion: undefined };
      if (!draft && !saved.latest?.draft) return;
      return {
        message: 'Draft saved',
        savedVersion:
          disk === 'saved' && options.acknowledgeSaved()
            ? draft
              ? `${draft.generation}:${draft.revision}`
              : saved.latest?.draft?.updated_at
            : undefined,
        failed: false,
        canKeepEditing: false,
      };
    }
    return {
      message:
        disk === 'failed'
          ? 'Changes could not be saved on this device'
          : 'Draft could not be synced',
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
      action: deletePending() ? 'retry-discard' : 'retry',
      canKeepEditing: deletePending(),
    };
  });
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
        ? 'Unable to read local draft status. Retry to check the saved draft.'
        : undefined),
    retry: () => {
      void run(
        saved.error
          ? async () => {
              await refetch();
            }
          : deletePending()
            ? options.discard
            : options.retry
      );
    },
    keepEditing: () => {
      void run(options.retry);
    },
  };
}
