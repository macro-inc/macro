import '../../../index.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { CallRecordingVideo } from '../component/CallRecording/CallRecordingVideo';
import { createRecordingPlayback } from '../primitives/recording-playback';
import clip from './clip.webm?url';

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
