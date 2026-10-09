import { enclosing } from './affine';
import type { GraphicsDocument } from './model';
import { children, nodeBoundsPoints, roots } from './scene';
import { isShape } from './shapes/registry';

export function fullyConnected(doc: GraphicsDocument, id: string): boolean {
  const item = doc.items[id];
  return (
    item?.type === 'connector' &&
    !!item.geometry.start.binding &&
    !!item.geometry.end.binding &&
    isShape(doc.items[item.geometry.start.binding.targetId]) &&
    isShape(doc.items[item.geometry.end.binding.targetId])
  );
}
function layoutCorners(
  doc: GraphicsDocument,
  id: string
): ReturnType<typeof nodeBoundsPoints> {
  if (fullyConnected(doc, id)) return [];
  return isShape(doc.items[id])
    ? nodeBoundsPoints(doc, id)
    : children(doc, id).flatMap((child) => layoutCorners(doc, child));
}
export function layoutBounds(doc: GraphicsDocument, id: string) {
  return enclosing(layoutCorners(doc, id));
}
function hasLayoutShape(doc: GraphicsDocument, id: string): boolean {
  if (fullyConnected(doc, id)) return false;
  return (
    isShape(doc.items[id]) ||
    children(doc, id).some((child) => hasLayoutShape(doc, child))
  );
}
export function layoutRoots(
  doc: GraphicsDocument,
  selection: readonly string[]
) {
  return roots(doc, selection).filter((id) => hasLayoutShape(doc, id));
}
