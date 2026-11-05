import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import XIcon from '@icon/system/regular/x.svg';
import { Button, Dialog } from '@ui';
import { createSignal, type JSX, Show } from 'solid-js';
import presenterPhoto from '../assets/presenter.jpg';
import { TUTORIAL_PRESENTER } from '../core/presenter';
import type { TutorialId } from '../core/tutorial-id';
import { type ShelfTutorial, TutorialShelf } from './TutorialShelf';

/**
 * The pill's play disc: dark grey on the pill's near-black with a solid
 * white triangle. The triangle's centroid sits on the disc's centre, which is
 * where the eye puts a play glyph's middle, so it reads as centred without
 * nudging.
 */
function PlayDisc() {
  return (
    <svg
      viewBox="0 0 96 96"
      aria-hidden="true"
      class="size-12 shrink-0 transition-transform not-touch:group-hover/play:scale-105 mobile:size-10"
    >
      <circle cx="48" cy="48" r="48" fill="white" fill-opacity="0.16" />
      <path
        d="M39 32 L67 48 L39 64 Z"
        fill="white"
        stroke="white"
        stroke-width="6"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/**
 * The tutorial video at 80% of the window, paused behind a play pill (play
 * disc, then the presenter and the video's length): the video never
 * autoplays. On phones the shared Dialog becomes its bottom sheet.
 */
export function TutorialVideoDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** The video's length, like "1:11". */
  length: string;
  videoUrl: string;
  posterUrl: string;
  /** Called once per opening, when playback really starts. */
  onPlayStarted: () => void;
  /** The other tutorials, offered on the shelf once this video ends. */
  more: readonly ShelfTutorial[];
  /** Switch the dialog to another tutorial, paused at its play button. */
  onSelectTutorial: (id: TutorialId) => void;
  /**
   * The strip under the video. It gets the dialog's close, so a link in it
   * can leave the video paused and closed behind it.
   */
  footer?: (close: () => void) => JSX.Element;
}) {
  const [started, setStarted] = createSignal(false);
  const [ended, setEnded] = createSignal(false);
  let video: HTMLVideoElement | undefined;
  let playButton: HTMLButtonElement | undefined;
  let playRecorded = false;

  const recordPlay = () => {
    setStarted(true);
    setEnded(false);
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

  const replay = () => {
    if (!video) return;
    setEnded(false);
    video.currentTime = 0;
    video.focus();
    fireAndForget(video.play(), 'video-tutorials');
  };

  const reset = () => {
    video?.pause();
    setStarted(false);
    setEnded(false);
    playRecorded = false;
  };

  const selectTutorial = (id: TutorialId) => {
    reset();
    props.onSelectTutorial(id);
    // The card that was pressed unmounts with the shelf; the next video's play
    // button takes focus, so Enter or Space starts it.
    playButton?.focus();
  };

  const changeOpen = (open: boolean) => {
    if (!open) reset();
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
            controls={started() && !ended()}
            onPlay={recordPlay}
            onEnded={() => setEnded(true)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') changeOpen(false);
            }}
            class="max-h-full w-full object-contain mobile:aspect-video"
          />
          <Show when={!started()}>
            {/* The dimmed poster also starts the video on a click; the pill
                is the button keyboards and screen readers use. */}
            <button
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              onClick={play}
              class="absolute inset-0 bg-[black]/45"
            />
            <div class="pointer-events-none absolute inset-0 grid place-items-center">
              <button
                ref={playButton}
                type="button"
                onClick={play}
                aria-label={t('tutorials.playTutorial', {
                  title: props.title,
                  length: props.length,
                })}
                class="group/play pointer-events-auto flex h-16 items-center gap-3 rounded-full border border-[white]/12 bg-[rgb(20_20_20/0.85)] py-2 pr-6 pl-2 whitespace-nowrap text-[white] shadow-2xl outline-none transition-colors not-touch:hover:bg-[rgb(38_38_38/0.9)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[white] mobile:h-12 mobile:gap-2 mobile:py-1 mobile:pr-4 mobile:pl-1"
              >
                <PlayDisc />
                <span
                  aria-hidden="true"
                  class="h-[60%] w-px shrink-0 bg-[white]/15"
                />
                <img
                  src={presenterPhoto}
                  alt=""
                  class="size-11 shrink-0 rounded-full object-cover mobile:size-9"
                />
                <span class="flex flex-col items-start text-left leading-tight">
                  <span class="text-base font-medium mobile:text-sm">
                    {TUTORIAL_PRESENTER}
                  </span>
                  <span class="text-sm text-[white]/60 tabular-nums mobile:text-xs">
                    {t('tutorials.watchDemo')} · {props.length}
                  </span>
                </span>
              </button>
            </div>
          </Show>
          <Show when={ended()}>
            {/* The last frame stays faintly visible under a dark wash; a
                click on it replays (the shelf's Replay is the keyboard path). */}
            <button
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              onClick={replay}
              class="absolute inset-0 bg-linear-to-t from-[black]/90 via-[black]/65 to-[black]/40 transition-opacity duration-500 starting:opacity-0"
            />
            <TutorialShelf
              tutorials={props.more}
              onSelect={selectTutorial}
              onReplay={replay}
              class="absolute inset-x-0 bottom-0 transition-[opacity,translate] duration-500 starting:translate-y-2 starting:opacity-0"
            />
          </Show>
        </div>
        <Show when={props.footer}>
          {(footer) => footer()(() => changeOpen(false))}
        </Show>
      </div>
    </Dialog>
  );
}
