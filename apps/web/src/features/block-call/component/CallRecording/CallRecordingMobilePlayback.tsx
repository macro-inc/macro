import { SearchState } from '@app/features/command/mobile/mobileSearchState';
import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import type { RecordingPlayback } from '../../primitives/recording-playback';
import { CallRecordingPinnedPlayer } from './CallRecordingPinnedPlayer';

export function CallRecordingMobilePlayback(props: {
  playback: RecordingPlayback;
  speaker: string;
  active: boolean;
  scrollingDown: boolean;
  onShowVideo: () => void;
}) {
  const active = () =>
    props.active && !SearchState.isOpen() && !virtualKeyboardVisible();
  const player = () => (
    <div class="px-(--mobile-chrome-gutter)">
      <CallRecordingPinnedPlayer
        playback={props.playback}
        speaker={props.speaker}
        onShowVideo={props.onShowVideo}
        mobile
      />
    </div>
  );
  return (
    <>
      <FloatRegion
        region="dock"
        priority={10}
        active={() => active() && props.scrollingDown}
      >
        {player()}
      </FloatRegion>
      <FloatRegion
        region="accessory"
        active={() => active() && !props.scrollingDown}
      >
        {player()}
      </FloatRegion>
    </>
  );
}
