import { type Matrix, translation } from '../core/affine';
import type { GraphicsEditor } from '../core/editor';
import type { Bounds, Point, ShapeKind } from '../core/model';
import { drawableIds, roots, worldMatrix } from '../core/scene';
import { isShape } from '../core/shapes/registry';

export type PresenceClock = Record<string, number>;
type WireMatrix = [number, number, number, number, number, number];
export type PresenceShape = {
  id: string;
  kind: ShapeKind;
  width: number;
  height: number;
  world: WireMatrix;
};
export type ActionPreview = {
  kind: 'draw' | 'move' | 'resize' | 'scale' | 'rotate' | 'marquee';
  shapes: PresenceShape[];
  box: Bounds | null;
};
export type PeerPresence = {
  id: string;
  name: string;
  color: string;
  cursor: Point | null;
  selectedIds: string[];
  clock: PresenceClock;
  preview: ActionPreview | null;
};
export type PresenceIdentity = Pick<PeerPresence, 'id' | 'name' | 'color'>;
const wireMatrix = (matrix: Matrix): WireMatrix => [...matrix];

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
  const drawing = editor.getPreview();
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
        shapes.push({
          id,
          kind: node.type,
          width: node.geometry.width,
          height: node.geometry.height,
          world: wireMatrix(worldMatrix(doc, id, overrides)),
        });
    }
    preview = {
      kind: session.transform.kind,
      shapes,
      box: null,
    };
  } else if (drawing && drawing.width > 0 && drawing.height > 0) {
    preview = {
      kind: 'draw',
      shapes: [
        {
          id: `draft-${identity.id}`,
          kind: editor.getDrawingKind(),
          width: drawing.width,
          height: drawing.height,
          world: wireMatrix(translation(drawing.x, drawing.y)),
        },
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

/** A delayed gesture is invalid as soon as either replica has another commit. */
export function currentPresencePreview(
  state: PeerPresence,
  clock: PresenceClock
): ActionPreview | null {
  const keys = new Set([...Object.keys(state.clock), ...Object.keys(clock)]);
  return [...keys].every((key) => (state.clock[key] ?? 0) === (clock[key] ?? 0))
    ? state.preview
    : null;
}
