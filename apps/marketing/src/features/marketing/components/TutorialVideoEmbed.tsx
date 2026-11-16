import { createEffect, createSignal, on, onMount, Show } from 'solid-js';
import { analytics } from '../../../app/utils/utilAnalytic';
import presenterPhoto from '../../../assets/people/tutorial-presenter.jpg';
import { createSitePalette } from '../../setup/sitePalette';
import {
  TUTORIAL_PRESENTER,
  TUTORIAL_VIDEOS,
  type TutorialVideoId,
  tutorialPosterUrl,
  tutorialPreviewUrl,
  tutorialVideoUrl,
} from '../core/tutorial-videos';
import { BenefitVideoPoster } from './benefits/BenefitVideoPoster';
import { FeatureDemoBackdrop } from './FeatureDemoBackdrop';
import { TutorialWallpaper } from './TutorialWallpaper';
import './tutorial-video-embed.css';

/** The app's play disc: a translucent circle with a rounded white triangle. */
function PlayDisc() {
  return (
    <svg viewBox="0 0 96 96" aria-hidden="true" class="tutorial-video-disc">
      <circle cx="48" cy="48" r="48" fill="currentColor" fill-opacity="0.16" />
      <path
        d="M39 32 L67 48 L39 64 Z"
        fill="currentColor"
        stroke="currentColor"
        stroke-width="6"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/**
 * The app window on the wallpaper. A frame that has not loaded yet waits out
 * of sight and fades in, so it never pops in over the wallpaper.
 */
function PreviewWindow(props: { src: string; light: boolean }) {
  const [pending, setPending] = createSignal(false);
  let image!: HTMLImageElement;
  const settle = () => setPending(false);
  const awaitFrame = () => setPending(!image.complete);

  onMount(awaitFrame);
  createEffect(on(() => props.src, awaitFrame, { defer: true }));

  return (
    <div class="tutorial-video-poster-window" data-pending={pending()}>
      <img
        ref={image}
        classList={{ 'tutorial-video-preview-light': props.light }}
        src={props.src}
        alt=""
        onLoad={settle}
        onError={settle}
      />
    </div>
  );
}

/**
 * Inline version of the app tutorial player, with its presenter play pill.
 * Keep the presentation in sync with apps/web/src/features/video-tutorials.
 * The website owns this adapter so it does not import the app runtime.
 */
export function TutorialVideoEmbed(props: {
  tutorial: TutorialVideoId;
  backdrop?: boolean;
}) {
  const palette = createSitePalette();
  const [started, setStarted] = createSignal(false);
  let video: HTMLVideoElement | undefined;
  let playRecorded = false;

  const tutorial = () => TUTORIAL_VIDEOS[props.tutorial];
  const usesBenefitPoster = () => {
    const entry = tutorial();
    return 'preview' in entry && entry.preview === 'benefit';
  };
  // The diagram stands in for the video until it starts. This is a class and
  // not a `:has()` on the diagram: the video must never be hidden when play is
  // requested, and some mobile browsers restyle `:has()` late.
  const showsBenefitPoster = () => usesBenefitPoster() && !started();

  const track = (action: 'played') => {
    analytics.track('tutorial_video', {
      tutorial: `macro-${props.tutorial}`,
      action,
      page_location: window.location.href,
    });
  };

  const play = async () => {
    if (!video) return;
    setStarted(true);
    // The pill unmounts, so the video takes focus and keeps Space working.
    video.focus();
    try {
      await video.play();
    } catch {
      // Playback was refused; bring the play pill back.
      setStarted(false);
    }
  };

  const recordPlay = () => {
    setStarted(true);
    if (playRecorded) return;
    playRecorded = true;
    track('played');
  };

  return (
    <section
      class="tutorial-video-embed"
      classList={{
        'tutorial-video-embed-backdrop': props.backdrop,
        'tutorial-video-embed-diagram': showsBenefitPoster(),
      }}
      aria-label={tutorial().title}
    >
      <Show when={props.backdrop}>
        <FeatureDemoBackdrop />
      </Show>
      <div
        class="tutorial-video-stage"
        classList={{
          'tutorial-video-stage-benefit': usesBenefitPoster(),
          'tutorial-video-stage-diagram': showsBenefitPoster(),
        }}
      >
        <video
          ref={video}
          src={tutorialVideoUrl(props.tutorial)}
          poster={
            usesBenefitPoster() ? undefined : tutorialPosterUrl(props.tutorial)
          }
          preload="none"
          playsinline
          tabIndex={-1}
          controls={started()}
          onPlaying={recordPlay}
        />
        <Show when={!started()}>
          <Show when={showsBenefitPoster()}>
            <BenefitVideoPoster tutorial={props.tutorial} />
          </Show>
          <Show when={!usesBenefitPoster()}>
            <div class="tutorial-video-poster" aria-hidden="true">
              <TutorialWallpaper tutorial={props.tutorial} />
              <PreviewWindow
                src={tutorialPreviewUrl(props.tutorial, palette() === 'cream')}
                light={palette() === 'cream'}
              />
            </div>
          </Show>
          {/* The poster also plays on a click; the pill is the
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
              <span>
                Watch {tutorial().feature} demo · {tutorial().length}
              </span>
            </span>
          </button>
        </Show>
      </div>
    </section>
  );
}
