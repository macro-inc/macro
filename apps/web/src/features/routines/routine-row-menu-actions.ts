import { openBulkEditModal } from '@app/features/entity/bulk-edit/BulkEditEntityModal';
import {
  makeCopyEntityIdAction,
  makeCopyLinkAction,
} from '@app/features/next-soup/actions';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { globalSplitManager } from '@app/signal/splitLayout';
import { toast } from '@core/component/Toast/Toast';
import { enableRoutineSharing } from '@core/constant/featureFlags';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowSquareOutIcon from '@icon/system/regular/arrow-square-out.svg';
import { getOwner } from 'solid-js';
import { match } from 'ts-pattern';
import type { RoutineRowMenuActions } from './components/routine-row-menu';
import type { RoutineListSource } from './context/routine-sources';
import { getErrorMessage } from './core/routine-draft';
import type { RoutineRow } from './core/types';
import { createRoutineRowOperations } from './queries/routine-sources';
import { openShareRoutineDialog } from './routine-template';

/** Where the list is shown, and how it opens a routine. */
type RoutineListHost = {
  /** Open the routine in place of the list. */
  open(id: string): void;
  /** Absent where the host has no splits, as in Settings. */
  openInNewSplit?(id: string): void;
  /** Absent where the host has no desktop tabs. */
  openInNewTab?(id: string): void;
};

/**
 * The routine list's row menu: run, switch, copy, link, share and delete a
 * routine without opening it.
 */
export function useRoutineRowMenuActions(
  source: RoutineListSource,
  host: RoutineListHost
): RoutineRowMenuActions {
  const owner = getOwner();
  const sharing = useFeatureFlag(enableRoutineSharing);
  const copyLink = makeCopyLinkAction();
  const copyId = makeCopyEntityIdAction();
  const operations = createRoutineRowOperations({
    onError: (operation, error) =>
      toast.alert(
        match(operation)
          .with('run', () => t('routineMenu.runFailed'))
          .with('duplicate', () => t('routineMenu.duplicateFailed'))
          .with('keep', () => t('routineMenu.keepFailed'))
          .exhaustive(),
        { subtext: getErrorMessage(error) }
      ),
    onRunStarted: () => toast.success(t('routineMenu.runStarted')),
    // The copy stays in the list; the toast opens it.
    onDuplicated: (id) =>
      toast.success(t('routineMenu.duplicated'), {
        dismissStyle: 'icon',
        actions: [
          {
            label: t('entityActions.open'),
            icon: ArrowSquareOutIcon,
            trailingIcon: true,
            onClick: () => host.open(id),
          },
        ],
      }),
    onKept: () => toast.success(t('subRoutines.kept')),
  });
  const share = (row: RoutineRow) =>
    openShareRoutineDialog({ routineId: row.id, name: row.name }, owner);
  const remove = async (row: RoutineRow) => {
    const entity = operations.entity(row.id);
    if (!entity) return;
    // Everything its runs created is deleted with it, finished one-time
    // routines too, which the list doesn't hold: say how many.
    const created =
      (await operations.createdCount(row.id)) ??
      source.subRoutines().filter((routine) => routine.parent?.id === row.id)
        .length;
    openBulkEditModal({
      view: 'delete',
      entities: [entity],
      note:
        created > 0
          ? t('subRoutines.deleteNote', { count: created })
          : undefined,
      onFinish: () => toast.success(t('entityActions.toastDeleted')),
      onError: () => toast.failure(t('entityActions.toastDeleteFailed')),
    });
  };
  const openInNewSplit = host.openInNewSplit;
  const openInNewTab = host.openInNewTab;
  return {
    onOpenInNewSplit: openInNewSplit && ((row) => openInNewSplit(row.id)),
    canOpenInNewSplit: () => globalSplitManager()?.canAppendSplit() ?? false,
    onOpenInNewTab: openInNewTab && ((row) => openInNewTab(row.id)),
    onRun: (row) => operations.run(row.id),
    runPending: (row) => operations.runPending(row.id),
    onDuplicate: (row) => operations.duplicate(row.id),
    onKeep: (row) => operations.keepAsOwn(row.id),
    onCopyLink: (row) =>
      fireAndForget(copyLink.executeByBlock(row.id, 'routine'), 'routines'),
    onCopyId: (row) => fireAndForget(copyId.executeById(row.id), 'routines'),
    // Sharing turns a routine into a template others can start from.
    get onShare() {
      return sharing().enabled ? share : undefined;
    },
    onDelete: (row) => fireAndForget(remove(row), 'routines'),
    entity: (row) => operations.entity(row.id),
  };
}
