import { t } from '@app/lib/i18n';
import SpeakerSlash from '@icon/system/regular/speaker-slash.svg';
import { cn, Tooltip } from '@ui';
import { Show } from 'solid-js';

export function MutedForYouBadge(props: { muted: boolean; inline?: boolean }) {
  return (
    <Show when={props.muted}>
      <Tooltip
        label={t('calls.mutedForYou')}
        class={cn(!props.inline && 'absolute bottom-0 left-0 z-40')}
      >
        <Show
          when={props.inline}
          fallback={
            <span
              data-call-muted-for-you
              role="img"
              aria-label={t('calls.mutedForYou')}
              class="grid size-5 place-items-center rounded-full bg-surface-2 text-ink-muted ring-1 ring-edge-muted"
            >
              <SpeakerSlash class="size-3" />
            </span>
          }
        >
          <SpeakerSlash
            data-call-muted-for-you
            role="img"
            aria-label={t('calls.mutedForYou')}
            class="size-3 shrink-0 text-ink-muted"
          />
        </Show>
      </Tooltip>
    </Show>
  );
}
