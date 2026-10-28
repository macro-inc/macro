import { type Component, createMemo } from 'solid-js';
import { resolveAppearance } from '../../core/appearance';
import { pencilInk } from '../../core/shapes/pencil';
import type { ShapeViewProps } from '../shape-renderers';

export const PencilView: Component<ShapeViewProps<'pencil'>> = (props) => {
  const ink = createMemo(() => pencilInk(props.item));
  return (
    <svg width="100%" height="100%" style={{ overflow: 'visible' }}>
      <path
        d={ink().path}
        fill={props.item.appearance.stroke}
        opacity={resolveAppearance(props.item.appearance).opacity}
        visibility={
          resolveAppearance(props.item.appearance).strokeWidth === 0
            ? 'hidden'
            : undefined
        }
      />
    </svg>
  );
};
