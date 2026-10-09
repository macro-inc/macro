import {
  type Camera,
  type ConnectorTarget,
  connectorAnchors,
  worldToScreen,
} from '@macro-inc/graphics';
import { For, Show } from 'solid-js';

/** Only the hovered shape exposes ports; the active port gets a larger halo. */
export function ConnectorTargets(props: {
  camera: Camera;
  target: ConnectorTarget;
}) {
  return (
    <svg
      class="pointer-events-none absolute inset-0 size-full overflow-visible"
      aria-label="Connector attachment targets"
    >
      <For each={connectorAnchors}>
        {(anchor) => {
          const point = () =>
            worldToScreen(
              props.camera,
              props.target.ports.find((port) => port.anchor === anchor)!.point
            );
          const active = () => props.target.active?.anchor === anchor;
          return (
            <g>
              <Show when={active()}>
                <circle
                  data-connector-target-halo={anchor}
                  cx={point().x}
                  cy={point().y}
                  r="14"
                  fill="#5687ff"
                  fill-opacity="0.25"
                  stroke="#5687ff"
                  stroke-opacity="0.6"
                  stroke-width="1"
                />
              </Show>
              <circle
                data-connector-target={`${props.target.targetId}:${anchor}`}
                data-active={active()}
                cx={point().x}
                cy={point().y}
                r="6"
                fill="white"
                stroke="#5687ff"
                stroke-width="1"
              />
            </g>
          );
        }}
      </For>
    </svg>
  );
}
