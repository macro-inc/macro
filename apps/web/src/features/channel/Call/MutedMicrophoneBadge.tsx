import { t } from '@app/lib/i18n';
import MicrophoneSlash from '@icon/system/regular/microphone-slash.svg';
import { cn, Tooltip } from '@ui';
import { type JSX, Show } from 'solid-js';

export type MutedMicrophoneBadgeProps = {
  muted: boolean;
  label?: string;
  inline?: boolean;
  avatar?: boolean;
};

export function MutedMicrophoneBadge(
  props: MutedMicrophoneBadgeProps
): JSX.Element {
  return (
    <Show when={props.muted}>
      <Tooltip
        label={t('calls.microphoneOff')}
        class={cn(
          props.avatar &&
            'absolute bottom-0 right-0 z-40 aspect-square w-1/2 max-w-5'
        )}
      >
        <span
          data-call-microphone-off
          role="status"
          aria-label={props.label ?? t('calls.microphoneOff')}
          class={cn(
            'flex shrink-0 items-center justify-center text-failure',
            props.inline ? '' : 'rounded-full bg-surface-2',
            props.avatar
              ? 'size-full'
              : !props.inline && 'absolute top-2 right-2 z-10 size-7'
          )}
        >
          <MicrophoneSlash
            aria-hidden="true"
            class={cn(
              props.inline || props.avatar ? 'size-3' : 'size-5',
              props.avatar && 'max-h-3/4 max-w-3/4'
            )}
          />
        </span>
      </Tooltip>
    </Show>
  );
}
