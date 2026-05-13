import { useBlockEntityCommands } from '@app/component/next-soup/actions';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { toast } from 'core/component/Toast/Toast';
import { createEffect, createSignal, Show } from 'solid-js';
import { blockData } from '../signal/blockData';
import { ModalsProvider } from './ModalsProvider';
import { TopBar } from './TopBar';

export default function BlockVideo() {
  useBlockEntityCommands();
  return (
    <DocumentBlockContainer>
      <div class="size-full bg-surface select-none overscroll-none overflow-hidden flex flex-col relative">
        <ModalsProvider>
          <div class="relative">
            <TopBar />
          </div>
          <div class="w-full grow relative overflow-hidden">
            <Video />
          </div>
        </ModalsProvider>
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
    <div class="size-full flex flex-col items-center justify-center gap-3 text-ink">
      <Show when={videoUrl()}>
        <video
          class="size-full"
          controls
          autoplay
          src={videoUrl()}
          onError={(e) => {
            console.error('video error', e);
            setPlaybackError('Video playback failed');
          }}
        />
      </Show>
    </div>
  );
};
