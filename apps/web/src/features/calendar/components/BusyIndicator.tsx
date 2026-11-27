import { t } from '@app/lib/i18n';
import BriefcaseIcon from '@macro-inc/entity-icons/svg/briefcase.svg';
import { Tooltip } from '@ui';
import { Show } from 'solid-js';

export type BusyIndicatorProps = {
  /** Only a confirmed conflict is busy; missing or incomplete data is unknown. */
  busy?: boolean;
};

/**
 * Marks a confirmed guest conflict without implying unknown guests are free.
 * @do Supply only availability confirmed by an authorized source.
 * @dont Infer guest availability from the viewer's own calendar.
 */
export function BusyIndicator(props: BusyIndicatorProps) {
  return (
    <Show when={props.busy === true}>
      <Tooltip label={t('calendar.busy')}>
        <span
          role="img"
          aria-label={t('calendar.busy')}
          class="inline-flex shrink-0 text-amber-ink"
        >
          <BriefcaseIcon class="size-3 touch:size-[13px]" aria-hidden="true" />
        </span>
      </Tooltip>
    </Show>
  );
}
