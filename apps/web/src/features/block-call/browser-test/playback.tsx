import '../../../index.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { CallRecordingVideo } from '../component/CallRecording/CallRecordingVideo';
import { createRecordingPlayback } from '../primitives/recording-playback';
import clip from './clip.webm?url';

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
    </main>
  );
}
render(() => <PlaybackFixture />, document.getElementById('root')!);
