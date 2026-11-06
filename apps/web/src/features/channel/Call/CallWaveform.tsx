import Waveform from '@icon/system/regular/waveform.svg';
import { cn } from '@ui';
import './call-waveform.css';

/** The shared live mark; motion follows call liveness, not voice volume. */
export function CallWaveform(props: { class?: string }) {
  return (
    <Waveform
      class={cn('call-waveform text-success', props.class)}
      data-icon-motion="none"
    />
  );
}
