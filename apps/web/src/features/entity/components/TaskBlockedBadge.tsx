import { t } from '@app/lib/i18n';
import ProhibitIcon from '@icon/system/regular/prohibit.svg';
import { Show } from 'solid-js';

/** One warning treatment for unfinished dependencies on desktop and phone. */
export function TaskBlockedBadge(props: { blocked?: boolean }) {
  return (
    <Show when={props.blocked}>
      <span class="inline-flex shrink-0 items-center gap-1 rounded-full border border-edge-muted px-1.5 py-0.5 text-xxs font-normal text-warning">
        <ProhibitIcon class="size-3 shrink-0" />
        {t('entityActions.taskBlocked')}
      </span>
    </Show>
  );
}
