import { createMemo, For, Show } from 'solid-js';
import { resolveAppearance, strokeDasharray } from '../../core/appearance';
import {
  connectorHead,
  connectorPath,
} from '../../core/shapes/connector-routing';
import type { ShapeViewProps } from '../shape-renderers';

export function ConnectorView(props: ShapeViewProps<'connector'>) {
  const route = createMemo(() =>
    connectorPath(
      props.item.geometry.start,
      props.item.geometry.end,
      props.item.geometry.route
    )
  );
  const style = () => resolveAppearance(props.item.appearance);
  return (
    <svg
      width="1"
      height="1"
      style={{
        overflow: 'visible',
        position: 'absolute',
        left: '0',
        top: '0',
        'pointer-events': 'none',
      }}
    >
      <g
        stroke={style().stroke}
        stroke-width={style().strokeWidth}
        opacity={style().opacity}
        stroke-linecap="round"
        stroke-linejoin="round"
        fill="none"
      >
        <path
          stroke-dasharray={strokeDasharray(props.item.appearance)}
          d={route().path}
          data-graphics-connector-path={props.item.id}
        />
        <For each={['start', 'end'] as const}>
          {(end) => {
            const headStyle = () =>
              end === 'start'
                ? props.item.geometry.startHead
                : props.item.geometry.endHead;
            const head = () =>
              connectorHead(
                props.item.geometry[end].point,
                end === 'start' ? route().from : route().to,
                headStyle()
              );
            return (
              <Show when={headStyle() !== 'none'}>
                <Show
                  when={head().radius}
                  fallback={
                    <path
                      d={head().path}
                      fill={
                        headStyle() === 'arrow-filled' ? style().stroke : 'none'
                      }
                    />
                  }
                >
                  <circle
                    cx={props.item.geometry[end].point.x}
                    cy={props.item.geometry[end].point.y}
                    r={head().radius}
                    fill={style().stroke}
                    stroke="none"
                  />
                </Show>
              </Show>
            );
          }}
        </For>
      </g>
    </svg>
  );
}
