import type { ShapeViewProps } from '../shape-renderers';

/** Hosts run artifact HTML in their own sandbox; graphics never executes it. */
export function ArtifactPlaceholder(props: ShapeViewProps<'artifact'>) {
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
      {props.item.geometry.title || 'Artifact'}
    </div>
  );
}
