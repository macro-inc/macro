import MicrophoneSlash from '@icon/system/regular/microphone-slash.svg';
import { type JSX, Show } from 'solid-js';

export type MutedMicrophoneBadgeProps = {
  muted: boolean;
  label: string;
  inline?: boolean;
};

export function MutedMicrophoneBadge(
  props: MutedMicrophoneBadgeProps
): JSX.Element {
  return (
    <Show when={props.muted}>
      <div
        role="status"
        aria-label={props.label}
        class={
          props.inline
            ? 'pointer-events-none flex shrink-0 items-center text-failure'
            : 'pointer-events-none absolute top-2 right-2 z-10 flex size-7 items-center justify-center rounded-full border border-edge bg-surface/90 text-failure'
        }
      >
        <MicrophoneSlash
          aria-hidden="true"
          class={props.inline ? 'size-3' : 'size-5'}
        />
      </div>
    </Show>
  );
}
