import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type {
  FeatureScreen,
  FeatureScreenFrame,
  PhoneScreen,
} from '../core/feature-screens';
import type { TutorialVideoId } from '../core/tutorial-videos';
import { TutorialWallpaper } from './TutorialWallpaper';
import './feature-screenshot.css';

/** A real Macro app screen on a dark or feature-themed stage, outlined where the section's point is. */
export function FeatureScreenshot(props: {
  screen: FeatureScreen;
  wallpaper?: TutorialVideoId;
  variant?: number;
}) {
  return (
    <figure
      class="feature-screenshot"
      classList={{ 'feature-screenshot--wallpaper': Boolean(props.wallpaper) }}
      data-narrow={props.screen.narrow ? '' : undefined}
      data-light={props.screen.lightSrc ? '' : undefined}
      data-wallpaper-variant={
        props.wallpaper ? (props.variant ?? 0) % 4 : undefined
      }
    >
      <Show when={props.wallpaper}>
        {(wallpaper) => (
          <div class="feature-screenshot-backdrop" aria-hidden="true">
            <TutorialWallpaper tutorial={wallpaper()} />
          </div>
        )}
      </Show>
      <div class="feature-screenshot-frame">
        <ScreenCanvas
          frame={props.screen}
          alt={props.screen.alt}
          class="feature-screenshot-wide"
        />
        <Show when={props.screen.narrow}>
          {(narrow) => (
            <ScreenCanvas
              frame={narrow()}
              alt={props.screen.alt}
              class="feature-screenshot-narrow"
            />
          )}
        </Show>
      </div>
    </figure>
  );
}

/**
 * One capture in a viewport that scrolls sideways on phones. The canvas is
 * sized so the outlined part fits the phone's width, and the scroll starts on it.
 */
function ScreenCanvas(props: {
  frame: FeatureScreenFrame;
  alt: string;
  class: string;
}) {
  let viewport: HTMLDivElement | undefined;
  const [scrollable, setScrollable] = createSignal(false);

  const showFocus = () => {
    if (!viewport) return;
    const overflow = viewport.scrollWidth > viewport.clientWidth;
    setScrollable(overflow);
    if (!overflow) return;

    const focus = props.frame.focus;
    if (!focus) {
      viewport.scrollLeft = 0;
      return;
    }

    const scale = viewport.scrollWidth / props.frame.width;
    const left = focus.x * scale;
    const width = focus.width * scale;
    if (width > viewport.clientWidth) {
      viewport.scrollLeft = left;
      return;
    }
    viewport.scrollLeft = left + width / 2 - viewport.clientWidth / 2;
  };

  onMount(() => {
    const resize = new ResizeObserver(showFocus);
    if (viewport) resize.observe(viewport);
    onCleanup(() => resize.disconnect());
  });

  const percent = (value: number, total: number) => `${(value / total) * 100}%`;

  // Phones: wide enough to read (up to 640px), narrow enough that the focus
  // and a 12px margin each side fit the viewport.
  const phoneWidth = () => {
    const focus = props.frame.focus;
    if (!focus) return undefined;
    const fit = props.frame.width / (focus.width + 24);
    return `clamp(100%, ${(fit * 100).toFixed(1)}%, 640px)`;
  };

  // Keep the 2px outline + 2px offset inside the clipped frame on every edge.
  const clampedFocus = () => {
    const focus = props.frame.focus;
    if (!focus) return undefined;
    const padX = Math.max(8, Math.round(props.frame.width * 0.01));
    const padY = Math.max(8, Math.round(props.frame.height * 0.01));
    const left = Math.max(focus.x, padX);
    const top = Math.max(focus.y, padY);
    const right = Math.min(focus.x + focus.width, props.frame.width - padX);
    const bottom = Math.min(focus.y + focus.height, props.frame.height - padY);
    return {
      x: left,
      y: top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  };

  return (
    <div
      ref={viewport}
      class={`feature-screenshot-viewport ${props.class}`}
      tabIndex={scrollable() ? 0 : undefined}
      role={scrollable() ? 'group' : undefined}
      aria-label={scrollable() ? 'App screen, scrolls sideways' : undefined}
    >
      <div
        class="feature-screenshot-canvas"
        style={{ '--phone-canvas-width': phoneWidth() }}
      >
        <PaletteImage
          src={props.frame.src}
          lightSrc={props.frame.lightSrc}
          width={props.frame.width}
          height={props.frame.height}
          alt={props.alt}
        />
        <Show when={clampedFocus()}>
          {(focus) => (
            <span
              class="feature-screenshot-focus"
              aria-hidden="true"
              style={{
                left: percent(focus().x, props.frame.width),
                top: percent(focus().y, props.frame.height),
                width: percent(focus().width, props.frame.width),
                height: percent(focus().height, props.frame.height),
              }}
            />
          )}
        </Show>
      </div>
    </div>
  );
}

/** The product's phone screens in a row that scrolls sideways on phones. */
export function FeaturePhoneScreens(props: {
  screens: readonly PhoneScreen[];
  product: string;
}) {
  return (
    <section
      class="feature-page-section"
      aria-label={`${props.product} on your phone`}
    >
      <ul class="feature-phone-screens">
        <For each={props.screens}>
          {(screen) => (
            <li data-light={screen.lightSrc ? '' : undefined}>
              <div class="feature-phone-screen">
                <PaletteImage
                  src={screen.src}
                  lightSrc={screen.lightSrc}
                  width={screen.width}
                  height={screen.height}
                  alt={screen.alt}
                />
              </div>
              <h3>{screen.title}</h3>
              <p>{screen.text}</p>
            </li>
          )}
        </For>
      </ul>
    </section>
  );
}

/**
 * A capture, with its Macro Light frame for the cream palette when there is one.
 * CSS shows the frame for the palette; the hidden lazy image is never fetched.
 */
function PaletteImage(props: {
  src: string;
  lightSrc?: string;
  width: number;
  height: number;
  alt: string;
}) {
  return (
    <>
      <img
        class={props.lightSrc ? 'palette-dark-only' : undefined}
        src={props.src}
        width={props.width}
        height={props.height}
        alt={props.alt}
        loading="lazy"
        decoding="async"
      />
      <Show when={props.lightSrc}>
        {(lightSrc) => (
          <img
            class="palette-light-only"
            src={lightSrc()}
            width={props.width}
            height={props.height}
            alt={props.alt}
            loading="lazy"
            decoding="async"
          />
        )}
      </Show>
    </>
  );
}
