import type { Component } from 'solid-js';
import { resolveAppearance } from '../../core/appearance';
import type { ShapeViewProps } from '../shape-renderers';
import { ShapeLabelView } from './label';
import type { TextContentView } from './text';

export const EllipseView: Component<
  ShapeViewProps<'ellipse'> & {
    hideLabel?: boolean;
    contentView?: TextContentView;
  }
> = (props) => (
  <>
    <svg width="100%" height="100%" style={{ overflow: 'visible' }}>
      <ellipse
        cx="50%"
        cy="50%"
        rx={props.item.geometry.width / 2}
        ry={props.item.geometry.height / 2}
        fill={props.preview ? 'none' : props.item.appearance.fill}
        stroke={props.item.appearance.stroke}
        stroke-width={
          props.preview
            ? 2 / props.scale
            : resolveAppearance(props.item.appearance).strokeWidth
        }
        opacity={resolveAppearance(props.item.appearance).opacity}
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
