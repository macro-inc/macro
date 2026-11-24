import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import ArrowCounterClockwiseIcon from '@icon/system/regular/arrow-counter-clockwise.svg';
import type { RoutineListSource } from './context/routine-sources';
import { canToggleRoutine } from './core/routine-menu';
import type { RoutineRow } from './core/types';

/**
 * Switch a routine from its card. Turning one off says so with Undo, since
 * it stops acting at once; turning one on needs no notice, its card shows it.
 * Undo is offered only where its switch could turn it back on: not while a
 * run is in progress, nor once a one-time routine has run.
 */
export function toggleRoutine(
  source: Pick<RoutineListSource, 'setEnabled'>,
  row: RoutineRow,
  options: { undo: boolean }
) {
  source.setEnabled(row.id, !row.enabled);
  if (!row.enabled || !options.undo) return;
  const undoable = canToggleRoutine({ ...row, enabled: false }, false);
  toast.success(t('routinesList.turnedOff', { name: row.name }), {
    subtext: t('routinesList.turnedOffHint'),
    dismissStyle: 'icon',
    actions: undoable
      ? [
          {
            label: t('entityActions.undo'),
            icon: ArrowCounterClockwiseIcon,
            onClick: () => source.setEnabled(row.id, true),
          },
        ]
      : [],
  });
}
