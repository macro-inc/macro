import { t } from '@app/lib/i18n';
import SpeakerSlash from '@icon/system/regular/speaker-slash.svg';
import { cn, Tooltip } from '@ui';
import { Show } from 'solid-js';

export function MutedForYouBadge(props: { muted: boolean; inline?: boolean }) {
  return (
    <Show when={props.muted}>
      <Tooltip
        label={t('calls.mutedForYou')}
        class={cn(
          !props.inline &&
            'absolute bottom-0 left-0 z-40 aspect-square w-1/2 max-w-5'
        )}
      >
        <Show
          when={props.inline}
          fallback={
            <span
              data-call-muted-for-you
              role="img"
              aria-label={t('calls.mutedForYou')}
              class="grid size-full place-items-center rounded-full bg-surface-2 text-ink-muted ring-1 ring-edge-muted"
            >
              <SpeakerSlash class="size-3 max-h-3/4 max-w-3/4" />
            </span>
          }
        >
          <SpeakerSlash
            data-call-muted-for-you
            role="img"
            aria-label={t('calls.mutedForYou')}
            aria-hidden="false"
            class="size-3 shrink-0 text-ink-muted"
          />
        </Show>
      </Tooltip>
    </Show>
  );
}
