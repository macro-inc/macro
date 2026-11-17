import type { ArtifactItem, GraphicsDocument } from './model';
import { sortKeysBetween } from './ordering';

/** Artifacts in presentation order. Concurrent inserts can share a key, so the
 * ID breaks ties the same way on every client. */
export function presentationOrder(document: GraphicsDocument): ArtifactItem[] {
  const artifacts = Object.values(document.items).filter(
    (item): item is ArtifactItem => item.type === 'artifact'
  );

  return artifacts.sort((a, b) => {
    const left = a.geometry.presentOrder;
    const right = b.geometry.presentOrder;
    if (left !== right) return left < right ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
}

/** Sort key placing a new artifact after every existing one. */
export function nextPresentOrder(document: GraphicsDocument): string {
  const last = presentationOrder(document).at(-1);
  return sortKeysBetween(last?.geometry.presentOrder ?? null, null, 1)[0]!;
}

/** The whole presentation with one artifact moved by `delta` places, or undefined
 * when it would leave the ends. */
export function movedInPresentation(
  document: GraphicsDocument,
  id: string,
  delta: number
): string[] | undefined {
  const ids = presentationOrder(document).map((item) => item.id);
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= ids.length) return undefined;

  ids.splice(from, 1);
  ids.splice(to, 0, id);
  return ids;
}
