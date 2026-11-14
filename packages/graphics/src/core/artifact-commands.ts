import { presentationOrder } from './artifact-order';
import type { GraphicsCommand } from './commands';
import { sortKeysBetween } from './ordering';
import { type ArtifactGeometry, artifactDefinition } from './shapes/artifact';
import { type SlideTransition, validSlideTransition } from './slide-transition';

/** Omitted fields keep their value. `transition: null` removes the slide's own
 * transition, so it inherits the deck default again. */
export type ArtifactContent = Partial<
  Pick<
    ArtifactGeometry,
    'title' | 'html' | 'designWidth' | 'designHeight' | 'presentOrder'
  >
> & { transition?: SlideTransition | null };

function withContent(
  geometry: ArtifactGeometry,
  { transition, ...content }: ArtifactContent
): ArtifactGeometry {
  const next = { ...geometry, ...content };
  if (transition === undefined) return next;
  if (transition) return { ...next, transition };

  const { transition: _removed, ...inherited } = next;
  return inherited;
}

/** One completed content edit is one document operation; box size and pose
 * stay with transform commands. */
export const setArtifactCommand: GraphicsCommand<{
  id: string;
  content: ArtifactContent;
}> = {
  id: 'set-artifact',
  apply: ({ document }, { id, content }) => {
    const before = document.items[id];
    if (before?.type !== 'artifact') throw new Error('Not an artifact');

    const geometry = withContent(before.geometry, content);
    if (!artifactDefinition.validateGeometry(geometry))
      throw new Error('Invalid artifact geometry');

    const item = { ...before, geometry };
    if (artifactDefinition.sameGeometry(before, item)) return { document };

    return {
      document: { ...document, items: { ...document.items, [id]: item } },
      selection: [id],
    };
  },
};

/** Listed artifacts present first, in that order; the rest keep their order after
 * them. One reorder is one undo step. */
export const setPresentationOrderCommand: GraphicsCommand<{
  ids: readonly string[];
}> = {
  id: 'set-presentation-order',
  apply: ({ document }, { ids }) => {
    const items = { ...document.items };
    const listed = new Set(ids);
    for (const id of ids) {
      if (document.items[id]?.type !== 'artifact')
        throw new Error('Not an artifact');
    }

    const ordered = [
      ...ids,
      ...presentationOrder(document)
        .map((item) => item.id)
        .filter((id) => !listed.has(id)),
    ];
    const keys = sortKeysBetween(null, null, ordered.length);
    ordered.forEach((id, index) => {
      const item = document.items[id];
      if (item?.type !== 'artifact') return;

      items[id] = {
        ...item,
        geometry: { ...item.geometry, presentOrder: keys[index]! },
      };
    });

    return { document: { ...document, items } };
  },
};

/** Gives every artifact the same transition, or with null clears every slide's
 * own transition so all inherit the deck default. One undo step. */
export const setAllTransitionsCommand: GraphicsCommand<{
  transition: SlideTransition | null;
}> = {
  id: 'set-all-transitions',
  apply: ({ document }, { transition }) => {
    if (transition && !validSlideTransition(transition))
      throw new Error('Invalid slide transition');

    const items = { ...document.items };
    for (const item of Object.values(document.items)) {
      if (item.type !== 'artifact') continue;

      items[item.id] = {
        ...item,
        geometry: withContent(item.geometry, { transition }),
      };
    }

    return { document: { ...document, items } };
  },
};
