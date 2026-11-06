import Waveform from '@icon/system/regular/waveform.svg';
import { cn } from '@ui';
import './call-waveform.css';
import { type SpeakingCall, useCallSpeaking } from './use-call-speaking';

/** The live mark stays still unless its joined call reports speech. */
export function CallWaveform(
  props: SpeakingCall & { class?: string; speaking?: boolean }
) {
  const isSpeaking = useCallSpeaking();
  return (
    <Waveform
      class={cn('call-waveform text-success', props.class)}
      data-speaking={props.speaking ?? isSpeaking(props)}
      data-icon-motion="none"
    />
  );
}
