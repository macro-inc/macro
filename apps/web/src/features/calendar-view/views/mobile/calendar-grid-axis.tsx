import { MOBILE_EDGE_FADE_FALLOFF, mobileEdgeFade } from '@core/util/edge-fade';
import { type Accessor, For, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { createMobileGridAxis } from '../../primitives/create-mobile-grid-axis';

/** One stationary horizontal gutter follows the active page's vertical scroll. */
export function MobileCalendarGridAxis(props: {
  root: Accessor<HTMLElement | undefined>;
  viewport: Accessor<HTMLElement | undefined>;
}) {
  const axis = createMobileGridAxis(props.root, props.viewport);
  return (
    <>
      <div
        class="pointer-events-none absolute left-0 z-10 w-[var(--calendar-phone-axis-width)] text-right text-[10px] font-medium text-ink-extra-muted"
        style={{
          top: `${axis.state.allDayTop}px`,
          'padding-right': 'var(--calendar-phone-axis-gap)',
        }}
      >
        All day
      </div>
      <div
        data-calendar-hour-axis
        class="pointer-events-none absolute left-0 z-10 overflow-hidden bg-page text-[10px] font-medium text-ink-extra-muted"
        style={{
          top: `${axis.state.top}px`,
          height: `${axis.state.height}px`,
          width: 'var(--calendar-phone-axis-width)',
        }}
      >
        <div style={{ transform: `translateY(${-axis.state.scrollTop}px)` }}>
          <For each={axis.state.labels}>
            {(label) => (
              <div
                class="absolute inset-x-0 text-right"
                style={{
                  top: `${label.top}px`,
                  height: `${label.height}px`,
                  'padding-right': 'var(--calendar-phone-axis-gap)',
                }}
              >
                {label.text}
              </div>
            )}
          </For>
          <Show when={axis.state.now}>
            {(now) => (
              <div
                class="absolute inset-x-0 bg-page text-right font-semibold text-accent"
                style={{
                  top: `${now().top}px`,
                  'padding-right': 'var(--calendar-phone-axis-gap)',
                }}
              >
                {now().text}
              </div>
            )}
          </Show>
        </div>
        <div
          class="absolute inset-x-0 top-0"
          style={{
            height: `${MOBILE_EDGE_FADE_FALLOFF}px`,
            background: mobileEdgeFade('top', 'var(--color-page)'),
            opacity: axis.faded() ? 1 : 0,
          }}
        />
      </div>
      <Show when={axis.scrollElement()?.parentElement}>
        {(host) => (
          <Portal mount={host()}>
            <div
              data-calendar-card-fade
              aria-hidden="true"
              class="pointer-events-none absolute right-0 top-0 z-10"
              style={{
                left: 'var(--calendar-phone-axis-width)',
                height: `${MOBILE_EDGE_FADE_FALLOFF}px`,
                background: mobileEdgeFade('top', 'var(--color-surface-2)'),
                opacity: axis.faded() ? 1 : 0,
              }}
            />
          </Portal>
        )}
      </Show>
    </>
  );
}
