import { type Matrix, multiply, translation } from '../core/affine';
import { resolveAppearance } from '../core/appearance';
import type { GraphicsEditor } from '../core/editor';
import type {
  Bounds,
  GraphicsDocument,
  GraphicsItem,
  Point,
  ShapeItem,
  ShapeKind,
} from '../core/model';
import { drawableIds, roots, worldBounds, worldMatrix } from '../core/scene';
import { isShape, shapeDefinition } from '../core/shapes/registry';

export type PresenceClock = Record<string, number>;
type WireMatrix = [number, number, number, number, number, number];
export type PresenceShape = {
  id: string;
  kind: ShapeKind;
  width: number;
  height: number;
  world: WireMatrix;
  pencil?: { points: [number, number, number][]; simulatePressure: boolean };
  strokeWidth?: number;
  cornerRadius?: number;
  /** Bounded host-rendered AI presentation; never imported into the document. */
  item?: {
    type: 'rectangle' | 'ellipse' | 'text' | 'connector';
    geometry: string;
    appearance: {
      fill: string;
      stroke: string;
      strokeWidth?: number;
      strokeStyle?: 'solid' | 'dashed' | 'dotted';
      opacity?: number;
      cornerRadius?: number;
    };
  };
};
export type ActionGuard = {
  items: Record<string, string | null>;
  regions: Bounds[];
  occupants: string[];
};
export type ActionPreview = {
  kind:
    | 'draw'
    | 'move'
    | 'resize'
    | 'scale'
    | 'rotate'
    | 'radius'
    | 'marquee'
    | 'ai';
  shapes: PresenceShape[];
  box: Bounds | null;
  guard?: ActionGuard;
};
export type PeerPresence = {
  id: string;
  name: string;
  color: string;
  cursor: Point | null;
  selectedIds: string[];
  clock: PresenceClock;
  preview: ActionPreview | null;
  reducedMotion?: boolean;
  /** Real operation groups in one atomic AI batch; never additional CRDT writers. */
  lanes?: {
    id: string;
    name: string;
    color: string;
    itemIds: string[];
    cursor: Point | null;
  }[];
};
export type PresenceIdentity = Pick<PeerPresence, 'id' | 'name' | 'color'>;
const wireMatrix = (matrix: Matrix): WireMatrix => [...matrix];

function presenceShape(node: ShapeItem, world: Matrix): PresenceShape {
  const bounds = shapeDefinition(node.type).bounds(node);
  const boundsOnly = !['rectangle', 'ellipse', 'pencil'].includes(node.type);
  return {
    id: node.id,
    // Host-specific text, media, references and connectors use bounds-only ghosts.
    // Their complete geometry/content is intentionally absent from presence.
    kind: boundsOnly ? 'rectangle' : node.type,
    width: bounds.width,
    height: bounds.height,
    world: wireMatrix(
      boundsOnly ? multiply(world, translation(bounds.x, bounds.y)) : world
    ),
    ...(node.type === 'rectangle'
      ? { cornerRadius: node.appearance.cornerRadius ?? 0 }
      : {}),
    ...(node.type === 'pencil'
      ? {
          pencil: {
            points: node.geometry.points.map((p) => [...p]),
            simulatePressure: node.geometry.simulatePressure,
          },
          strokeWidth: resolveAppearance(node.appearance).strokeWidth,
        }
      : {}),
  };
}

/** Read-only capture: committed data and local gestures never receive remote state. */
export function capturePresence(
  editor: GraphicsEditor,
  identity: PresenceIdentity,
  clock: PresenceClock,
  cursor: Point | null
): PeerPresence {
  const doc = editor.getSession().transform?.document ?? editor.document;
  const session = editor.getSession();
  const selectedIds = [...roots(doc, session.selectedIds)];
  let preview: ActionPreview | null = null;
  const drawing = editor.getDrawingPreview({
    fill: 'transparent',
    stroke: identity.color,
  });
  if (session.transform) {
    const overrides = session.transform.nodes;
    const targets = new Set(selectedIds);
    const shapes: PresenceShape[] = [];
    for (const id of drawableIds(doc)) {
      let ancestor = doc.items[id];
      while (
        ancestor &&
        ancestor.type !== 'surface' &&
        !targets.has(ancestor.id)
      )
        ancestor = doc.items[ancestor.placement.parentId];
      if (!ancestor || !targets.has(ancestor.id)) continue;
      const node = overrides[id] ?? doc.items[id];
      if (isShape(node))
        shapes.push(presenceShape(node, worldMatrix(doc, id, overrides)));
    }
    preview = {
      kind: session.transform.kind,
      shapes,
      box: null,
    };
  } else if (drawing) {
    preview = {
      kind: 'draw',
      shapes: [
        presenceShape(
          { ...drawing, id: `draft-${identity.id}` },
          drawing.transform
        ),
      ],
      box: null,
    };
  } else if (session.box) {
    preview = {
      kind: 'marquee',
      shapes: [],
      box: { ...session.box },
    };
  }
  return {
    ...identity,
    cursor: cursor ? { ...cursor } : null,
    selectedIds,
    clock,
    preview,
  };
}

/** Loro values may enumerate object keys differently across WASM replicas. */
export function presenceItemState(
  item: GraphicsItem | undefined
): string | null {
  return item
    ? JSON.stringify(item, (_, value: unknown) =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? Object.fromEntries(
              Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
            )
          : value
      )
    : null;
}

/** A delayed gesture is invalid as soon as either replica has another commit. */
export function currentPresencePreview(
  state: PeerPresence,
  clock: PresenceClock,
  document?: GraphicsDocument
): ActionPreview | null {
  const guard = state.preview?.guard;
  if (state.preview?.kind === 'ai' && guard) {
    if (
      !document ||
      Object.entries(guard.items).some(
        ([id, value]) => presenceItemState(document.items[id]) !== value
      )
    )
      return null;
    const current = presenceRegionOccupants(document, guard.regions);
    return JSON.stringify(current) === JSON.stringify(guard.occupants)
      ? state.preview
      : null;
  }
  const keys = new Set([...Object.keys(state.clock), ...Object.keys(clock)]);
  return [...keys].every((key) => (state.clock[key] ?? 0) === (clock[key] ?? 0))
    ? state.preview
    : null;
}

/** Membership plus individual item preconditions prevents stale ghosts after any target change. */
export function presenceRegionOccupants(
  document: GraphicsDocument,
  regions: Bounds[]
): string[] {
  return Object.values(document.items)
    .filter((item) => {
      if (item.type === 'surface' || item.type === 'connector') return false;
      const bounds = worldBounds(document, item.id);
      return regions.some(
        (region) =>
          region.x < bounds.x + bounds.width &&
          bounds.x < region.x + region.width &&
          region.y < bounds.y + bounds.height &&
          bounds.y < region.y + region.height
      );
    })
    .map((item) => item.id)
    .sort();
}
