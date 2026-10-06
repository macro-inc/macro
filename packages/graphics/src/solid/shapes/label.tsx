import { Show } from 'solid-js';
import { cssMatrix } from '../../core/affine';
import {
  type LabelShape,
  shapeLabelLayout,
  shapeLabelText,
} from '../../core/shapes/label';
import { type TextContentView, TextView } from './text';

export function ShapeLabelView(props: {
  item: LabelShape;
  scale: number;
  hidden?: boolean;
  contentView?: TextContentView;
}) {
  return (
    <Show when={!props.hidden && props.item.geometry.label}>
      <div
        data-graphics-label={props.item.id}
        style={{
          position: 'absolute',
          left: '0',
          top: '0',
          'transform-origin': '0 0',
          transform: cssMatrix(shapeLabelLayout(props.item)!.transform),
          'pointer-events': 'none',
        }}
      >
        <TextView
          contentView={props.contentView}
          item={shapeLabelText(props.item)!}
          scale={props.scale}
        />
      </div>
    </Show>
  );
}
