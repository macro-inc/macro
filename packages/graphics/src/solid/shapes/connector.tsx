import { createMemo, createUniqueId, For, Show } from 'solid-js';
import { resolveAppearance, strokeDasharray } from '../../core/appearance';
import {
  connectorHead,
  connectorPath,
} from '../../core/shapes/connector-routing';
import { shapeLabelLayout } from '../../core/shapes/label';
import type { ShapeViewProps } from '../shape-renderers';
import { ShapeLabelView } from './label';
import type { TextContentView } from './text';

export function ConnectorView(
  props: ShapeViewProps<'connector'> & {
    hideLabel?: boolean;
    contentView?: TextContentView;
  }
) {
  const route = createMemo(() =>
    connectorPath(
      props.item.geometry.start,
      props.item.geometry.end,
      props.item.geometry.route
    )
  );
  const maskId = createUniqueId();
  const label = createMemo(() => shapeLabelLayout(props.item));
  const style = () => resolveAppearance(props.item.appearance);
  return (
    <>
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
        <Show when={label()}>
          {(layout) => (
            <defs>
              <mask
                id={maskId}
                maskUnits="userSpaceOnUse"
                x={route().bounds.x - 100}
                y={route().bounds.y - 100}
                width={route().bounds.width + 200}
                height={route().bounds.height + 200}
              >
                <rect
                  x={route().bounds.x - 100}
                  y={route().bounds.y - 100}
                  width={route().bounds.width + 200}
                  height={route().bounds.height + 200}
                  fill="white"
                />
                <rect
                  x={layout().transform[4] - 4}
                  y={layout().transform[5] - 2}
                  width={layout().geometry.width + 8}
                  height={layout().geometry.height + 4}
                  fill="black"
                />
              </mask>
            </defs>
          )}
        </Show>
        <g
          stroke={style().stroke}
          stroke-width={style().strokeWidth}
          opacity={style().opacity}
          stroke-linecap="round"
          stroke-linejoin="round"
          fill="none"
        >
          <path
            mask={label() ? `url(#${maskId})` : undefined}
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
                          headStyle() === 'arrow-filled'
                            ? style().stroke
                            : 'none'
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
      <ShapeLabelView
        item={props.item}
        scale={props.scale}
        hidden={props.hideLabel || props.preview}
        contentView={props.contentView}
      />
    </>
  );
}
