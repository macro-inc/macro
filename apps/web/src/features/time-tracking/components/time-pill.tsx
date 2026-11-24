import { t } from '@app/lib/i18n';
import ClockIcon from '@icon/system/regular/clock.svg';
import { propertyPillClasses } from '@property/extractors/property-pill-classes';
import { type JSX, Show, splitProps } from 'solid-js';
import { formatLength } from '../core/format-length';

type TimePillProps = Omit<
  JSX.ButtonHTMLAttributes<HTMLButtonElement>,
  'children'
> & {
  /** The task's Time logged, in minutes. */
  minutes: number;
};

/** The task's Time logged as a pill in its property row; opens the Time panel. */
export function TimePill(props: TimePillProps): JSX.Element {
  const [local, rest] = splitProps(props, ['minutes', 'class']);
  const logged = () => local.minutes > 0;
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={
        logged()
          ? t('timeTracking.pillLabel', { length: formatLength(local.minutes) })
          : t('timeTracking.pillEmptyLabel')
      }
      class={propertyPillClasses({
        variant: 'outline',
        size: 'xs',
        empty: !logged(),
        class: local.class,
      })}
      {...rest}
    >
      <span class="inline-flex min-w-0 items-center gap-1">
        <ClockIcon class="size-3.5 shrink-0" aria-hidden="true" />
        <Show when={logged()} fallback={t('timeTracking.pill')}>
          <span class="tabular-nums">{formatLength(local.minutes)}</span>
        </Show>
      </span>
    </button>
  );
}
