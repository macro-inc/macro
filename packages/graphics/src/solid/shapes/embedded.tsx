import type { ShapeViewProps } from '../shape-renderers';
/** Host apps resolve media and document references through their own services. */
export function EmbeddedPlaceholder(
  props: ShapeViewProps<'image' | 'video' | 'document'>
) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        border: '1px solid currentColor',
        display: 'grid',
        'place-items': 'center',
        opacity: props.item.appearance.opacity ?? 1,
      }}
    >
      {props.item.geometry.name || props.item.type}
    </div>
  );
}
