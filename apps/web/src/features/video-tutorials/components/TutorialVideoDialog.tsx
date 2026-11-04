import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import PlayIcon from '@icon/system/regular/play.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Button, Dialog } from '@ui';
import { createSignal, Show } from 'solid-js';

/**
 * The tutorial video at 80% of the window, with a big play button: the video
 * never autoplays. On phones the shared Dialog becomes its bottom sheet.
 */
export function TutorialVideoDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  videoUrl: string;
  posterUrl: string;
  /** Called once per opening, when playback really starts. */
  onPlayStarted: () => void;
}) {
  const [started, setStarted] = createSignal(false);
  let video: HTMLVideoElement | undefined;
  let playRecorded = false;

  const recordPlay = () => {
    setStarted(true);
    if (playRecorded) return;
    playRecorded = true;
    props.onPlayStarted();
  };

  const play = () => {
    if (!video) return;
    setStarted(true);
    // The play overlay unmounts, so hand focus to the video: Space and Escape keep working.
    video.focus();
    fireAndForget(video.play(), 'video-tutorials');
  };

  const changeOpen = (open: boolean) => {
    if (!open) {
      video?.pause();
      setStarted(false);
      playRecorded = false;
    }
    props.onOpenChange(open);
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={changeOpen}
      position="center"
      animate
      class="w-[80vw] max-w-[80vw] mobile:w-full mobile:max-w-full"
    >
      <div class="flex h-[80vh] w-full flex-col mobile:h-auto">
        <div class="flex h-12 shrink-0 items-center gap-2 pr-2 pl-4 mobile:hidden">
          <Dialog.Title class="min-w-0 flex-1 truncate text-sm font-medium text-ink">
            {props.title}
          </Dialog.Title>
          <Dialog.CloseButton
            as={Button}
            variant="ghost"
            size="icon-md"
            aria-label={t('tutorials.closeVideo')}
          >
            <XIcon class="size-4 shrink-0" />
          </Dialog.CloseButton>
        </div>
        <div class="relative mx-2 mb-2 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[18px] bg-[black] mobile:m-0 mobile:rounded-none">
          <video
            ref={video}
            src={props.videoUrl}
            poster={props.posterUrl}
            preload="metadata"
            playsinline
            tabIndex={-1}
            controls={started()}
            onPlay={recordPlay}
            onKeyDown={(event) => {
              if (event.key === 'Escape') changeOpen(false);
            }}
            class="max-h-full w-full object-contain mobile:aspect-video"
          />
          <Show when={!started()}>
            <button
              type="button"
              onClick={play}
              aria-label={t('tutorials.playVideo')}
              class="absolute inset-0 grid place-items-center bg-[black]/30 outline-none"
            >
              <span class="grid size-24 place-items-center rounded-full bg-[white] text-[black] shadow-2xl transition-transform not-touch:hover:scale-105 mobile:size-16">
                <PlayIcon class="ml-1.5 size-10 mobile:size-7" />
              </span>
            </button>
          </Show>
        </div>
      </div>
    </Dialog>
  );
}
