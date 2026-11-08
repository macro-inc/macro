import '../../../index.css';
import { ListSortDropdown } from '@app/components/view-shell/ListDropdowns';
import {
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
} from '@app/features/theme/constants';
import { applyTheme } from '@app/features/theme/utils/themeUtils';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { CallRecordingVideo } from '../component/CallRecording/CallRecordingVideo';
import {
  createRecordingPlayback,
  RECORDING_PLAYBACK_RATES,
} from '../primitives/recording-playback';
import clip from './clip.webm?url';

const params = new URLSearchParams(location.search);
applyTheme(
  params.get('theme') === 'light' ? DEFAULT_LIGHT_THEME : DEFAULT_DARK_THEME
);

// Mirror the application shell's input-modality markers.
document.addEventListener(
  'keydown',
  () => {
    document.documentElement.dataset.modality = 'keyboard';
  },
  { capture: true }
);
document.addEventListener(
  'mousedown',
  () => {
    document.documentElement.dataset.modality = 'mouse';
  },
  { capture: true }
);
document.addEventListener(
  'touchstart',
  () => {
    document.documentElement.dataset.modality = 'touch';
  },
  { capture: true, passive: true }
);
function PlaybackFixture() {
  const [video, setVideo] = createSignal<HTMLVideoElement>();
  const playback = createRecordingPlayback(video);
  return (
    <main class="mx-auto max-w-[800px] p-4 pt-16">
      <CallRecordingVideo
        url={clip}
        playback={playback}
        setVideoRef={(element) => {
          element.loop = true;
          setVideo(element);
        }}
      />
      <button type="button" class="mt-6" id="outside">
        Outside player
      </button>
      <Show when={params.get('reference') === 'sort'}>
        <ListSortDropdown
          label="Reference sort"
          value={String(playback.rate())}
          options={RECORDING_PLAYBACK_RATES.map((rate) => ({
            id: String(rate),
            label: `${rate}×`,
          }))}
          onChange={(rate) => playback.setRate(Number(rate))}
        />
      </Show>
    </main>
  );
}
render(() => <PlaybackFixture />, document.getElementById('root')!);
