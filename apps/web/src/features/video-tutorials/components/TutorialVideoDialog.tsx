import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import XIcon from '@icon/system/regular/x.svg';
import { Button, Dialog } from '@ui';
import { createSignal, type JSX, Show } from 'solid-js';

/**
 * The big play button: a solid black disc with a filled white triangle. The
 * triangle's centroid sits on the disc's centre, which is where the eye puts a
 * play glyph's middle, so it reads as centred without nudging.
 */
function PlayButtonGlyph() {
  return (
    <svg
      viewBox="0 0 96 96"
      aria-hidden="true"
      class="size-24 rounded-full drop-shadow-2xl outline-offset-4 outline-[white] group-focus-visible/play:outline-2 transition-transform not-touch:group-hover/play:scale-105 mobile:size-16"
    >
      <circle
        cx="48"
        cy="48"
        r="47.5"
        fill="black"
        stroke="white"
        stroke-opacity="0.18"
      />
      <path
        d="M37.5 30 L69 48 L37.5 66 Z"
        fill="white"
        stroke="white"
        stroke-width="6"
        stroke-linejoin="round"
      />
    </svg>
  );
}

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
  /**
   * The strip under the video. It gets the dialog's close, so a link in it
   * can leave the video paused and closed behind it.
   */
  footer?: (close: () => void) => JSX.Element;
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
      class="w-[80vw] max-w-[80vw] mobile:w-auto mobile:max-w-none"
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
              class="group/play absolute inset-0 grid place-items-center bg-[black]/30 outline-none"
            >
              <PlayButtonGlyph />
            </button>
          </Show>
        </div>
        <Show when={props.footer}>
          {(footer) => footer()(() => changeOpen(false))}
        </Show>
      </div>
    </Dialog>
  );
}
