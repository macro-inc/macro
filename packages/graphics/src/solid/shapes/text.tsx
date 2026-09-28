import '../../browser/rich-text.css';
import type { Component } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { textLayoutStyle } from '../../browser/rich-text';
import { type RichText, richTextPlainText } from '../../core/rich-text';
import type { ShapeViewProps } from '../shape-renderers';
export type TextContentView = Component<{ content: RichText }>;
const PlainText: TextContentView = (props) => (
  <>{richTextPlainText(props.content)}</>
);
export function TextView(
  props: ShapeViewProps<'text'> & { contentView?: TextContentView }
) {
  return (
    <div
      class="graphics-rich-text"
      data-graphics-text={props.item.id}
      style={{
        ...textLayoutStyle(props.item.geometry),
        color: props.item.appearance.stroke,
        opacity: props.item.appearance.opacity ?? 1,
        'pointer-events': 'none',
      }}
    >
      <Dynamic
        component={props.contentView ?? PlainText}
        content={props.item.geometry.content}
      />
    </div>
  );
}
