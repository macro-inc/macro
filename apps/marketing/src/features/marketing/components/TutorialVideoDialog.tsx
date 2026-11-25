import { Dialog } from '@kobalte/core/dialog';
import X from '@phosphor/x.svg';
import Play from '@phosphor-fill/play-fill.svg';
import { createSignal, Show } from 'solid-js';
import { analytics } from '../../../app/utils/utilAnalytic';
import presenterPhoto from '../../../assets/people/tutorial-presenter.jpg';
import {
  TUTORIAL_PRESENTER,
  TUTORIAL_VIDEOS,
  type TutorialVideoId,
  tutorialPosterUrl,
  tutorialVideoUrl,
} from '../core/tutorial-videos';
import './tutorial-video-dialog.css';

/** The app's play disc: a translucent circle with a rounded white triangle. */
function PlayDisc() {
  return (
    <svg viewBox="0 0 96 96" aria-hidden="true" class="tutorial-video-disc">
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
 * A "Watch demo" button that opens the Block's tutorial video in a dialog,
 * paused behind the app's play pill until the visitor presses it (unless
 * `autoPlay` is set for direct play triggers).
 */
export function TutorialVideoDialog(props: {
  tutorial: TutorialVideoId;
  triggerClass?: string;
  triggerLabel?: string;
  triggerAriaLabel?: string;
  lengthClass?: string;
  autoPlay?: boolean;
}) {
  const [open, setOpen] = createSignal(false);
  const [started, setStarted] = createSignal(false);
  let video: HTMLVideoElement | undefined;
  let playButton: HTMLButtonElement | undefined;
  let playRecorded = false;

  const tutorial = () => TUTORIAL_VIDEOS[props.tutorial];

  const track = (action: 'opened' | 'played') => {
    analytics.track('tutorial_video', {
      tutorial: `macro-${props.tutorial}`,
      action,
      page_location: window.location.href,
    });
  };

  const changeOpen = (value: boolean) => {
    setStarted(false);
    playRecorded = false;
    setOpen(value);
    if (value) track('opened');
  };

  const play = async () => {
    if (!open() || !video?.isConnected) return;
    setStarted(true);
    // The pill unmounts, so the video takes focus and keeps Space working.
    video.focus();
    try {
      await video.play();
    } catch {
      if (!open()) return;
      // Playback was refused; bring the play pill back and move focus to it.
      setStarted(false);
      queueMicrotask(() => playButton?.focus());
    }
  };

  const recordPlay = () => {
    setStarted(true);
    if (playRecorded) return;
    playRecorded = true;
    track('played');
  };

  return (
    <Dialog open={open()} onOpenChange={changeOpen} modal>
      <Dialog.Trigger
        class={props.triggerClass ?? 'site-nav-demo tutorial-video-trigger'}
        aria-label={props.triggerAriaLabel}
      >
        <Play aria-hidden="true" />
        <span>{props.triggerLabel ?? 'Watch demo'}</span>
        <span class={props.lengthClass ?? 'tutorial-video-trigger-length'}>
          {tutorial().length}
        </span>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay class="tutorial-video-overlay" />
        <Dialog.Content
          class="tutorial-video-dialog"
          onOpenAutoFocus={(event) => {
            // Keep Space bound to the auto-playing video instead of Kobalte
            // moving focus onto the Close button on the next macrotask.
            if (!props.autoPlay || !video?.isConnected) return;
            event.preventDefault();
            video.focus();
          }}
        >
          <header class="tutorial-video-titlebar">
            <Dialog.Title>{tutorial().title}</Dialog.Title>
            <Dialog.CloseButton
              class="tutorial-video-close"
              aria-label="Close video"
            >
              <X />
            </Dialog.CloseButton>
          </header>
          <div class="tutorial-video-stage">
            <video
              ref={(element) => {
                video = element;
                if (props.autoPlay && open()) {
                  queueMicrotask(() => void play());
                }
              }}
              src={tutorialVideoUrl(props.tutorial)}
              poster={tutorialPosterUrl(props.tutorial)}
              preload="metadata"
              playsinline
              tabIndex={-1}
              controls={started()}
              onPlay={recordPlay}
            />
            <Show when={!started()}>
              {/* The dimmed poster also plays on a click; the pill is the
                  button keyboards and screen readers use. */}
              <button
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                class="tutorial-video-scrim"
                onClick={play}
              />
              <button
                ref={playButton}
                type="button"
                class="tutorial-video-play"
                aria-label={`Play ${tutorial().title}, ${tutorial().length}`}
                onClick={play}
              >
                <PlayDisc />
                <span class="tutorial-video-divider" aria-hidden="true" />
                <img src={presenterPhoto} alt="" />
                <span class="tutorial-video-byline">
                  <span>{TUTORIAL_PRESENTER}</span>
                  <span>Watch demo · {tutorial().length}</span>
                </span>
              </button>
            </Show>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
