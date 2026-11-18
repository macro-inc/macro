import type { ShapeItem } from '../../core/model';
import { shapePayload } from '../../core/shapes/registry';
import type { PresenceShape } from '../presence-state';

/** Shape kinds reject non-positive boxes; a growing ghost starts at size 0. */
const MIN_GHOST_SIZE = 0.01;

/**
 * The read-only item drawn for a peer's ghost, or `undefined` when the peer
 * sent geometry no shape accepts. Presence is untrusted wire data, so a
 * malformed ghost is skipped instead of throwing during render.
 */
export function presenceGhostItem(
  shape: PresenceShape,
  color: string
): ShapeItem | undefined {
  const width = Math.max(MIN_GHOST_SIZE, shape.width);
  const height = Math.max(MIN_GHOST_SIZE, shape.height);
  const placement = { parentId: 'presence-root', sortKey: 'a0' };
  try {
    if (shape.item) {
      const geometry: unknown = JSON.parse(shape.item.geometry);
      return {
        id: shape.id,
        ...shapePayload(
          shape.item.type,
          geometry && typeof geometry === 'object' && 'width' in geometry
            ? { ...geometry, width, height }
            : geometry
        ),
        appearance: shape.item.appearance,
        transform: shape.world,
        placement,
      };
    }
    return {
      id: shape.id,
      ...shapePayload(
        shape.kind,
        shape.kind === 'pencil' ? shape.pencil : { width, height }
      ),
      placement,
      transform: shape.world,
      appearance: {
        fill: 'transparent',
        stroke: color,
        strokeWidth: shape.strokeWidth,
        cornerRadius: shape.cornerRadius,
      },
    };
  } catch {
    return undefined;
  }
}
