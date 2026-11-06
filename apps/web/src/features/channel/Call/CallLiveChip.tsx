import { cn } from '@ui';
import { createSignal, onCleanup, Show } from 'solid-js';
import { CallWaveform } from './CallWaveform';
import { formatCallElapsed } from './discussion/format-call-elapsed';
import type { SpeakingCall } from './use-call-speaking';

export function CallLiveChip(
  props: SpeakingCall & {
    startedAt?: string;
    bare?: boolean;
    hideWave?: boolean;
    live?: boolean;
  }
) {
  const [now, setNow] = createSignal(Date.now());
  const timer = globalThis.setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => globalThis.clearInterval(timer));
  const elapsed = () => formatCallElapsed(props.startedAt, now());
  return (
    <span
      class={cn(
        'inline-flex shrink-0 items-center gap-1.5 text-xs font-medium tabular-nums text-success',
        !props.bare && 'rounded-full bg-success/10 px-2.5 py-1.5'
      )}
    >
      <Show when={!props.hideWave}>
        <CallWaveform
          class="size-3.5"
          live={props.live}
          callId={props.callId}
          channelId={props.channelId}
        />
      </Show>
      <Show when={elapsed()}>{elapsed()}</Show>
    </span>
  );
}
