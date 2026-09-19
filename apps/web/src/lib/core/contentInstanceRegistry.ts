import type { BlockAlias, BlockName } from './block';
import { resolveBlockAlias } from './constant/allBlocks';

export type ContentIdentity = {
  type: BlockName | BlockAlias | 'component';
  id: string;
};
export type ContentOwner = object | string | symbol;

export function sameContentIdentity(a: ContentIdentity, b: ContentIdentity) {
  if (a.type === 'component' || b.type === 'component') return false;
  return (
    a.id === b.id && resolveBlockAlias(a.type) === resolveBlockAlias(b.type)
  );
}

/** Owned by the app orchestrator; sources include selections before their UI mounts. */
export function createContentInstanceRegistry() {
  const sources = new Set<
    () => readonly { owner: ContentOwner; content: ContentIdentity }[]
  >();
  return {
    register(
      source: () => readonly { owner: ContentOwner; content: ContentIdentity }[]
    ) {
      sources.add(source);
      return () => {
        sources.delete(source);
      };
    },
    isOpenElsewhere(content: ContentIdentity, owner?: ContentOwner) {
      return [...sources].some((source) =>
        source().some(
          (entry) =>
            entry.owner !== owner && sameContentIdentity(entry.content, content)
        )
      );
    },
  };
}
