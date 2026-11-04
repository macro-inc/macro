import type { GraphicsCommand } from './commands';
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
