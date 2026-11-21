import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type { FeatureScreen, PhoneScreen } from '../core/feature-screens';
import './feature-screenshot.css';

/** A real Macro app screen on a dark stage, outlined where the section's point is. */
export function FeatureScreenshot(props: { screen: FeatureScreen }) {
  let viewport: HTMLDivElement | undefined;
  const [scrollable, setScrollable] = createSignal(false);

  // Phones show the screen at a readable width and scroll it sideways. Start
  // the scroll on the outlined part, so the point of the section is in view.
  const showFocus = () => {
    if (!viewport) return;
    const overflow = viewport.scrollWidth > viewport.clientWidth;
    setScrollable(overflow);
    if (!overflow) return;

    const focus = props.screen.focus;
    if (!focus) {
      viewport.scrollLeft = 0;
      return;
    }

    const scale = viewport.scrollWidth / props.screen.width;
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

  return (
    <figure class="feature-screenshot">
      <div class="feature-screenshot-frame">
        <div
          ref={viewport}
          class="feature-screenshot-viewport"
          tabIndex={scrollable() ? 0 : undefined}
        >
          <div class="feature-screenshot-canvas">
            <img
              src={props.screen.src}
              width={props.screen.width}
              height={props.screen.height}
              alt={props.screen.alt}
              loading="lazy"
              decoding="async"
              onLoad={showFocus}
            />
            <Show when={props.screen.focus}>
              {(focus) => (
                <span
                  class="feature-screenshot-focus"
                  aria-hidden="true"
                  style={{
                    left: percent(focus().x, props.screen.width),
                    top: percent(focus().y, props.screen.height),
                    width: percent(focus().width, props.screen.width),
                    height: percent(focus().height, props.screen.height),
                  }}
                />
              )}
            </Show>
          </div>
        </div>
      </div>
    </figure>
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
