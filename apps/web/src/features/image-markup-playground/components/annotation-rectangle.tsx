import type { ShapeViewProps } from '@macro-inc/graphics/solid';

/** Keep annotations readable while the underlying image is fitted or zoomed. */
export function AnnotationRectangle(props: ShapeViewProps<'rectangle'>) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        'box-sizing': 'border-box',
        border: `${2 / props.scale}px ${props.preview ? 'dashed' : 'solid'} ${props.item.appearance.stroke}`,
        'box-shadow': props.preview
          ? undefined
          : `0 0 0 ${1 / props.scale}px white, inset 0 0 0 ${1 / props.scale}px white`,
      }}
    />
  );
}
