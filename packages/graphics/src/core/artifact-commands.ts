import { presentationOrder } from './artifact-order';
import type { GraphicsCommand } from './commands';
import { sortKeysBetween } from './ordering';
import { type ArtifactGeometry, artifactDefinition } from './shapes/artifact';

export type ArtifactContent = Partial<
  Pick<
    ArtifactGeometry,
    'title' | 'html' | 'designWidth' | 'designHeight' | 'presentOrder'
  >
>;

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

    const geometry = { ...before.geometry, ...content };
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
