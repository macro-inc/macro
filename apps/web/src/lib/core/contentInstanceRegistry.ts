import type { BlockAlias, BlockName } from './block';
import { resolveBlockAlias } from './constant/allBlocks';

export type ContentIdentity = {
  type: BlockName | BlockAlias | 'component';
  id: string;
};
export type ContentOwner = object | string | symbol;

const REMINDER_DETAIL_COMPONENT_PREFIX = 'reminder-view~';

export function sameContentIdentity(a: ContentIdentity, b: ContentIdentity) {
  if (a.type === 'component' || b.type === 'component') {
    // Most component splits are workspaces that may be opened more than once.
    // A reminder-view component is an entity detail, so the exact same encoded
    // reminder id must remain single-instance across splits and inline previews.
    return (
      a.type === 'component' &&
      b.type === 'component' &&
      a.id.startsWith(REMINDER_DETAIL_COMPONENT_PREFIX) &&
      a.id === b.id
    );
  }
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
