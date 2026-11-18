import Microphone from '@icon/system/regular/microphone.svg';
import MicrophoneSlash from '@icon/system/regular/microphone-slash.svg';
import { Index, Show } from 'solid-js';

const SEGMENTS = 20;

/** Pre-join mic test: lights one segment per twentieth of input level. */
export function MicrophoneLevelMeter(props: {
  level: number;
  enabled: boolean;
}) {
  const lit = () => Math.round(props.level * SEGMENTS);
  return (
    <div class="mt-4 flex items-center gap-3 text-sm text-ink-muted">
      <Show
        when={props.enabled}
        fallback={<MicrophoneSlash class="size-4 shrink-0" />}
      >
        <Microphone class="size-4 shrink-0" />
      </Show>
      <div
        role="meter"
        aria-label="Microphone level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={props.enabled ? Math.round(props.level * 100) : 0}
        class="flex h-2.5 min-w-0 flex-1 gap-0.5"
      >
        <Index each={Array.from({ length: SEGMENTS })}>
          {(_, index) => (
            <span
              class="flex-1 rounded-full"
              classList={{
                'bg-success': props.enabled && index < lit(),
                'bg-edge-muted': !props.enabled || index >= lit(),
              }}
            />
          )}
        </Index>
      </div>
      <span class="shrink-0">
        {props.enabled ? 'Speak to test your mic' : 'Mic is off'}
      </span>
    </div>
  );
}
