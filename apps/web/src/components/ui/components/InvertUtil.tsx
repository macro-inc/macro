import type { ParentProps } from 'solid-js';
import { Layer } from './Layer';

/**
 * Gives a subtree an ink-colored surface and contrasting semantic colors.
 * Like Layer, this adds no layout box. Paint the section with bg-surface inside
 * the boundary, or put the boundary inside an existing bg-ink section.
 * Colors follow DOM inheritance; content portaled outside must opt in separately.
 */
export function InvertUtil(props: ParentProps) {
  return (
    <div data-invert-source style={{ display: 'contents' }}>
      <div data-invert class="text-ink" style={{ display: 'contents' }}>
        <Layer depth={0}>{props.children}</Layer>
      </div>
    </div>
  );
}
