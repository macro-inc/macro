import { Dialog } from '@kobalte/core/dialog';
import Play from '@phosphor-fill/play-fill.svg';
import X from '@phosphor/x.svg';
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
 * paused behind the app's play pill until the visitor presses it.
 */
export function TutorialVideoDialog(props: { tutorial: TutorialVideoId }) {
  const [open, setOpen] = createSignal(false);
  const [started, setStarted] = createSignal(false);
  let video: HTMLVideoElement | undefined;
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

  const play = () => {
    if (!video) return;
    setStarted(true);
    // The pill unmounts, so the video takes focus and keeps Space working.
    video.focus();
    video.play().catch(() => setStarted(false));
  };

  const recordPlay = () => {
    setStarted(true);
    if (playRecorded) return;
    playRecorded = true;
    track('played');
  };

  return (
    <Dialog open={open()} onOpenChange={changeOpen} modal>
      <Dialog.Trigger class="site-nav-demo tutorial-video-trigger">
        <Play aria-hidden="true" />
        <span>Watch demo</span>
        <span class="tutorial-video-trigger-length">{tutorial().length}</span>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay class="tutorial-video-overlay" />
        <Dialog.Content class="tutorial-video-dialog">
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
              ref={video}
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
