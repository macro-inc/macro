import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { demoHref, handleDemoBooked } from '../../../../app/utils/utilCta';
import { BOOKING_MADE, BOOKING_PATH, wasRefused } from '../DemoBookingDialog';

/**
 * The Macro demo booking page, framed inline. Loads the frame only once the
 * visitor nears it, so the ad landing page's first paint stays light. A
 * refused frame falls back to a link to the booking page.
 */
export function DemoBookingInline() {
  let host!: HTMLDivElement;
  let frame: HTMLIFrameElement | undefined;
  const [near, setNear] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);
  const [refused, setRefused] = createSignal(false);

  onMount(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setNear(true);
      },
      { rootMargin: '1200px 0px' }
    );
    observer.observe(host);
    const reportBooking = (event: MessageEvent) => {
      if (!frame?.contentWindow || event.source !== frame.contentWindow) return;
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === BOOKING_MADE) handleDemoBooked();
    };
    window.addEventListener('message', reportBooking);
    onCleanup(() => {
      observer.disconnect();
      window.removeEventListener('message', reportBooking);
    });
  });

  return (
    <Show
      when={!refused()}
      fallback={
        // The dialog would open the refused frame again, so keep the click
        // from reaching its document listener. Solid delegates `onClick` to
        // the document, so only a native handler runs first.
        <a
          class="site-nav-start homepage-hero-cta tour-cta"
          href={demoHref()}
          on:click={(event) => event.stopPropagation()}
        >
          Pick a time
        </a>
      }
    >
      <div ref={host} class="sales-booking-embed">
        <Show when={!loaded()}>
          <div class="sales-booking-loading" role="status">
            Loading…
          </div>
        </Show>
        <Show when={near()}>
          <iframe
            ref={frame}
            src={BOOKING_PATH}
            title="Book a demo"
            class="sales-booking-frame"
            onLoad={(event) => {
              setLoaded(true);
              setRefused(wasRefused(event.currentTarget));
            }}
          />
        </Show>
      </div>
    </Show>
  );
}
