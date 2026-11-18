import { t } from '@app/lib/i18n';
import { useBeforeLeave } from '@app/lib/split-router';
import { createDraftLeave } from '@core/util/create-draft-leave';
import { fireAndForget } from '@core/util/fireAndForget';
import { UnsavedChangesDialog } from '@ui';
import deepEqual from 'fast-deep-equal';
import { onCleanup } from 'solid-js';
import type { SavedViewLeaveSource } from '../context/saved-view-leave-source';

/** Reuses the app's leave dialog for route, sidebar, pane, and window exits. */
export function SavedViewLeaveGuard(props: {
  source: SavedViewLeaveSource;
  /** Selection fields, not filter/layout fields, in each watched namespace. */
  selection: Readonly<Record<string, readonly string[]>>;
}) {
  const leave = createDraftLeave({
    identity: props.source.identity,
    scope: props.source.viewerId,
    dirty: props.source.dirty,
    busy: props.source.busy,
    save: props.source.save,
    discard: props.source.discard,
    saveError: t('viewMenus.saveViewFailed'),
    staysInDraft: ({ from, to }) => {
      if (props.source.allowNavigation?.()) return true;
      if (!to || !deepEqual(from.location.route, to.location.route))
        return false;
      return Object.entries(props.selection).every(([namespace, keys]) =>
        keys.every((key) =>
          deepEqual(
            from.location.search?.[namespace]?.[key],
            to.location.search?.[namespace]?.[key]
          )
        )
      );
    },
  });
  onCleanup(props.source.register(leave.run));
  useBeforeLeave(leave.decide, {
    search: Object.keys(props.selection),
    descendants: true,
  });
  return (
    <UnsavedChangesDialog
      open={leave.open()}
      pending={leave.busy()}
      canSave={Boolean(props.source.identity())}
      error={leave.error()}
      title={t('viewMenus.leaveDraftTitle')}
      description={t('viewMenus.leaveDraftDescription')}
      cancelLabel={t('common.cancel')}
      onKeepEditing={leave.keepEditing}
      onDiscard={leave.discard}
      onSave={() => fireAndForget(leave.save(), 'saved-view-leave')}
    />
  );
}
