import { withAnalytics } from '@coparse/analytics';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { toast } from 'core/component/Toast/Toast';
import { createEffect, createSignal, Show } from 'solid-js';
import { blockData } from '../signal/blockData';
import { TopBar } from './TopBar';

const { track, TrackingEvents } = withAnalytics();

export default function BlockVideo() {
  return (
    <DocumentBlockContainer>
      <div class="w-full h-full bg-panel select-none overscroll-none overflow-hidden flex flex-col relative">
        <div class="relative">
          <TopBar />
        </div>
        <div class="w-full grow-1 relative overflow-hidden">
          <Video />
        </div>
      </div>
    </DocumentBlockContainer>
  );
}

const Video = () => {
  const videoUrl = () => blockData()?.videoUrl;
  const [playbackError, setPlaybackError] = createSignal<string>();

  createEffect(() => {
    const err = playbackError();
    if (err) {
      toast.failure(err);
    }
  });

  return (
    <div class="w-full h-full flex flex-col items-center justify-center gap-3 text-ink">
      <Show when={videoUrl()}>
        <video
          class="w-full h-full"
          controls
          autoplay
          src={videoUrl()}
          onError={(e) => {
            console.error('video error', e);
            track(TrackingEvents.BLOCKVIDEO.PLAYBACK.ERROR, { error: e });
            setPlaybackError('Video playback failed');
          }}
        />
      </Show>
    </div>
  );
};
