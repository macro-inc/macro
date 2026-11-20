import { isMobile } from '@core/mobile/isMobile';
import Waveform from '@icon/system/regular/waveform.svg';
import { cn } from '@ui';
import './call-waveform.css';
import {
  type SpeakingCall,
  useCallSpeaking,
} from '../primitives/use-call-speaking';

/** Static by default; designated desktop live marks follow joined-room speech. */
export function CallWaveform(
  props: SpeakingCall & { class?: string; speaking?: boolean; live?: boolean }
) {
  const isSpeaking = useCallSpeaking();
  const live = () => props.live && !isMobile();
  return (
    <Waveform
      class={cn('text-success', live() && 'call-waveform', props.class)}
      data-speaking={live() ? (props.speaking ?? isSpeaking(props)) : undefined}
      data-icon-motion="none"
    />
  );
}
