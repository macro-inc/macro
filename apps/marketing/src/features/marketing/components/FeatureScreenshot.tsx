import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type {
  FeatureScreen,
  FeatureScreenFrame,
  PhoneScreen,
} from '../core/feature-screens';
import './feature-screenshot.css';

/** A real Macro app screen on a dark stage, outlined where the section's point is. */
export function FeatureScreenshot(props: { screen: FeatureScreen }) {
  return (
    <figure
      class="feature-screenshot"
      data-narrow={props.screen.narrow ? '' : undefined}
    >
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
        <img
          src={props.frame.src}
          width={props.frame.width}
          height={props.frame.height}
          alt={props.alt}
          loading="lazy"
          decoding="async"
        />
        <Show when={props.frame.focus}>
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
    <section class="feature-page-section" aria-labelledby="phone-screens-title">
      <header class="product-feature-intro">
        <h2 id="phone-screens-title">
          <span>On your phone.</span>
        </h2>
        <p>
          {props.product} works the same in the Macro apps for iOS and Android.
        </p>
      </header>
      <ul class="feature-phone-screens">
        <For each={props.screens}>
          {(screen) => (
            <li>
              <img
                src={screen.src}
                width={screen.width}
                height={screen.height}
                alt={screen.alt}
                loading="lazy"
                decoding="async"
              />
              <h3>{screen.title}</h3>
              <p>{screen.text}</p>
            </li>
          )}
        </For>
      </ul>
    </section>
  );
}
