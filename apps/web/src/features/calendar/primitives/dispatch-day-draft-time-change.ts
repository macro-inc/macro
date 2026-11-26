import { DAY_DRAFT_ID, type DayDraftRangeBinding } from '../core/day-draft';

/** Never dispatch a draft interaction to persisted occurrence mutations. */
export function dispatchDayDraftTimeChange(
  change: {
    event: { id: string; start: Date | null; end: Date | null };
    jsEvent?: Pick<Event, 'type'>;
    revert: () => void;
  },
  interaction: 'resize' | 'drag',
  draft: Pick<DayDraftRangeBinding, 'resize'> | undefined,
  onPersisted: () => void
) {
  if (change.event.id !== DAY_DRAFT_ID) {
    onPersisted();
    return;
  }
  const { start, end } = change.event;
  if (
    change.jsEvent?.type === 'touchcancel' ||
    interaction === 'drag' ||
    !start ||
    !end ||
    !draft?.resize({ start, end })
  ) {
    change.revert();
  }
}
