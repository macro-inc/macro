import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import ArrowCounterClockwiseIcon from '@icon/system/regular/arrow-counter-clockwise.svg';
import type { RoutineListSource } from './context/routine-sources';
import type { RoutineRow } from './core/types';

/**
 * Switch a routine from its card. Turning one off says so with Undo, since
 * it stops acting at once; turning one on needs no notice, its card shows it.
 */
export function toggleRoutine(
  source: Pick<RoutineListSource, 'setEnabled'>,
  row: RoutineRow,
  options: { undo: boolean }
) {
  source.setEnabled(row.id, !row.enabled);
  if (!row.enabled || !options.undo) return;
  toast.success(t('routinesList.turnedOff', { name: row.name }), {
    subtext: t('routinesList.turnedOffHint'),
    dismissStyle: 'icon',
    actions: [
      {
        label: t('entityActions.undo'),
        icon: ArrowCounterClockwiseIcon,
        onClick: () => source.setEnabled(row.id, true),
      },
    ],
  });
}
