import type { RectangleItem } from '@macro-inc/graphics';

/** Keep annotations readable while the underlying image is fitted or zoomed. */
export function AnnotationRectangle(props: {
  item: RectangleItem;
  scale: number;
}) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        'box-sizing': 'border-box',
        border: `${2 / props.scale}px solid ${props.item.appearance.stroke}`,
        'box-shadow': `0 0 0 ${1 / props.scale}px white, inset 0 0 0 ${1 / props.scale}px white`,
      }}
    />
  );
}
