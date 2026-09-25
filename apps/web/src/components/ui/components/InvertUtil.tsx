import type { ParentProps } from 'solid-js';
import { Layer } from './Layer';

export type InvertUtilProps = ParentProps;

/**
 * Gives a subtree an ink-colored surface and contrasting semantic colors.
 * Like Layer, this adds no layout box. Paint the section with bg-surface inside
 * the boundary, or put the boundary inside an existing bg-ink section.
 * Colors follow DOM inheritance; content portaled outside must opt in separately.
 * @do Use semantic color tokens inside the inverted boundary.
 * @dont Assume portals outside the boundary inherit its palette.
 */
export function InvertUtil(props: InvertUtilProps) {
  return (
    <div data-invert-source style={{ display: 'contents' }}>
      <div data-invert class="text-ink" style={{ display: 'contents' }}>
        <Layer depth={0}>{props.children}</Layer>
      </div>
    </div>
  );
}
