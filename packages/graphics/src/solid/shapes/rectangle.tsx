import type { Component } from 'solid-js';
import { resolveAppearance } from '../../core/appearance';
import type { ShapeViewProps } from '../shape-renderers';
import { ShapeLabelView } from './label';
import type { TextContentView } from './text';

export const RectangleView: Component<
  ShapeViewProps<'rectangle'> & {
    hideLabel?: boolean;
    contentView?: TextContentView;
  }
> = (props) => {
  const style = () => resolveAppearance(props.item.appearance);
  return (
    <>
      <svg width="100%" height="100%" style={{ overflow: 'visible' }}>
        <rect
          width={props.item.geometry.width}
          height={props.item.geometry.height}
          rx={Math.min(
            style().cornerRadius,
            props.item.geometry.width / 2,
            props.item.geometry.height / 2
          )}
          fill={props.preview ? 'none' : style().fill}
          stroke={style().stroke}
          stroke-linejoin="round"
          stroke-width={props.preview ? 2 / props.scale : style().strokeWidth}
          opacity={style().opacity}
          stroke-dasharray={
            props.preview ? `${4 / props.scale} ${4 / props.scale}` : undefined
          }
        />
      </svg>
      <ShapeLabelView
        item={props.item}
        scale={props.scale}
        hidden={props.hideLabel || props.preview}
        contentView={props.contentView}
      />
    </>
  );
};
