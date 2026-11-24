import { formatLocale, t } from '@app/lib/i18n';
import CaretLeftIcon from '@icon/system/regular/caret-left.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import { Button } from '@ui';
import { type JSX, Show } from 'solid-js';
import { type DayRange, weekName } from '../core/time-period';

/** ‹ Nov 23 – 29 ›, with a way back to this week from another one. */
export function WeekStepper(props: {
  week: DayRange;
  /** Today, to name a week in another year with its year. */
  today: string;
  current: boolean;
  onPrevious(): void;
  onNext(): void;
  onThisWeek(): void;
}): JSX.Element {
  return (
    <div class="flex min-w-0 items-center gap-1">
      <Button
        variant="ghost"
        size="icon-md"
        aria-label={t('timeTracking.previousWeek')}
        tooltip={t('timeTracking.previousWeek')}
        onClick={() => props.onPrevious()}
      >
        <CaretLeftIcon class="size-4" />
      </Button>
      <span class="min-w-28 text-center text-sm font-medium tabular-nums">
        {weekName(props.week, props.today, formatLocale())}
      </span>
      <Button
        variant="ghost"
        size="icon-md"
        aria-label={t('timeTracking.nextWeek')}
        tooltip={t('timeTracking.nextWeek')}
        onClick={() => props.onNext()}
      >
        <CaretRightIcon class="size-4" />
      </Button>
      <Show when={!props.current}>
        <Button
          variant="secondary"
          size="md"
          onClick={() => props.onThisWeek()}
        >
          {t('timeTracking.periodThisWeek')}
        </Button>
      </Show>
    </div>
  );
}
