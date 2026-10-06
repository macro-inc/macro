import type { GraphicsDocument } from './model';
import { children, roots } from './scene';
import { isShape } from './shapes/registry';

/** Groups have no inherited style. Styling a group explicitly edits its leaves. */
export function selectedShapeIds(
  document: GraphicsDocument,
  selection: readonly string[]
): readonly string[] {
  const result: string[] = [];
  const visit = (id: string) => {
    if (isShape(document.items[id])) result.push(id);
    else for (const child of children(document, id)) visit(child);
  };
  roots(document, selection).forEach(visit);
  return result;
}
