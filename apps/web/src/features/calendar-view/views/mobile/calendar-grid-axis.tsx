import { MOBILE_EDGE_FADE_FALLOFF, mobileEdgeFade } from '@core/util/edge-fade';
import { type Accessor, Index, Show } from 'solid-js';
import { createMobileGridAxis } from '../../primitives/create-mobile-grid-axis';

/** One stationary gutter and time marker, outside every horizontally moving page. */
export function MobileCalendarGridAxis(props: {
  root: Accessor<HTMLElement | undefined>;
  viewport: Accessor<HTMLElement | undefined>;
  paused: Accessor<boolean>;
}) {
  const axis = createMobileGridAxis(props.root, props.viewport, props.paused);
  const labelBleed = () => Math.ceil((axis.state.labels[0]?.height ?? 14) / 2);
  return (
    <>
      <div
        data-calendar-hour-axis
        class="pointer-events-none absolute left-0 z-10 overflow-hidden bg-panel text-xxs font-medium text-ink-extra-muted"
        style={{
          top: '0',
          height: `${axis.state.top + axis.state.height}px`,
          width: 'var(--calendar-phone-axis-width)',
        }}
      >
        <div
          class="absolute inset-x-0 overflow-hidden"
          style={{
            top: `${axis.state.top - labelBleed()}px`,
            height: `${axis.state.height + labelBleed()}px`,
          }}
        >
          <div
            style={{
              transform: `translateY(${labelBleed() - axis.state.scrollTop}px)`,
            }}
          >
            <Index each={axis.state.labels}>
              {(label) => (
                <div
                  class="absolute inset-x-0 text-right"
                  style={{
                    top: `${label().top}px`,
                    height: `${label().height}px`,
                    'padding-right': 'var(--calendar-phone-axis-gap)',
                  }}
                >
                  {label().text}
                </div>
              )}
            </Index>
            <Show when={axis.state.now}>
              {(now) => (
                <div
                  class="absolute inset-x-0 -translate-y-1/2 text-right font-semibold leading-normal text-accent"
                  style={{
                    top: `${now().top + now().height / 2}px`,
                    'padding-right': 'var(--calendar-phone-axis-gap)',
                  }}
                >
                  {now().text}
                </div>
              )}
            </Show>
          </div>
        </div>
      </div>
      <div
        class="pointer-events-none absolute inset-x-0 z-10 overflow-hidden"
        style={{ top: `${axis.state.top}px`, height: `${axis.state.height}px` }}
      >
        <Show when={axis.state.now}>
          <div
            data-calendar-current-time-line
            aria-hidden="true"
            class="calendar-phone-now-line absolute right-0 h-px bg-accent"
            style={{
              left: 'var(--calendar-phone-axis-width)',
              top: `${axis.currentTimeTop()}px`,
            }}
          />
        </Show>
        <div
          data-calendar-card-fade
          aria-hidden="true"
          class="absolute right-0 top-0"
          style={{
            left: 'var(--calendar-phone-axis-width)',
            height: `${MOBILE_EDGE_FADE_FALLOFF}px`,
            background: mobileEdgeFade('top', 'var(--color-surface-2)'),
            opacity: axis.faded() ? 1 : 0,
          }}
        />
      </div>
    </>
  );
}
