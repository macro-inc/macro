import type { Appearance, ConnectorStyle } from '@macro-inc/graphics';
import { Match, Switch } from 'solid-js';

/** Small previews use the same visual vocabulary as the connector on the canvas. */
export function ConnectorRouteIcon(props: { route: ConnectorStyle['route'] }) {
  const path = () =>
    ({
      straight: 'M3 13 21 3',
      stepped: 'M3 13H12V3H21',
      smooth: 'M3 13C15 13 9 3 21 3',
    })[props.route];
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 16"
      class="h-3 w-[18px] shrink-0 text-ink-muted"
      fill="none"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d={path()} />
    </svg>
  );
}

export function ConnectorEndpointIcon(props: {
  head: ConnectorStyle['startHead'];
  start?: boolean;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 16"
      class="h-3 w-[18px] shrink-0 text-ink-muted"
      fill="none"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <g transform={props.start ? 'translate(24 0) scale(-1 1)' : undefined}>
        <path d="M3 8H20" />
        <Switch>
          <Match when={props.head === 'arrow'}>
            <path d="m15 3 5 5-5 5" />
          </Match>
          <Match when={props.head === 'arrow-filled'}>
            <path d="m14 3 7 5-7 5Z" fill="currentColor" />
          </Match>
          <Match when={props.head === 'circle'}>
            <circle cx="18" cy="8" r="4" fill="currentColor" />
          </Match>
          <Match when={props.head === 'circle-small'}>
            <circle cx="19" cy="8" r="2" fill="currentColor" />
          </Match>
        </Switch>
      </g>
    </svg>
  );
}

export function StrokeStyleIcon(props: { style: Appearance['strokeStyle'] }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 16"
      class="h-3 w-[18px] shrink-0 text-ink-muted"
      fill="none"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-linecap="round"
    >
      <path
        d="M3 8H21"
        stroke-dasharray={
          props.style === 'dashed'
            ? '4 3'
            : props.style === 'dotted'
              ? '0.1 4'
              : undefined
        }
      />
    </svg>
  );
}
