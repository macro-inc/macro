import type { BlockAlias, BlockName } from '@core/block';
import { resolveBlockAlias } from '@core/constant/allBlocks';
import { createSignal } from 'solid-js';

export type ContentIdentity = {
  type: BlockName | BlockAlias | 'component';
  id: string;
};
export type ContentOwner = object | string | symbol;

export type ContentInstance = {
  owner: ContentOwner;
  content: ContentIdentity;
  activate?: () => void;
};

export function sameContentIdentity(a: ContentIdentity, b: ContentIdentity) {
  if (a.type === 'component' || b.type === 'component') return false;
  return (
    a.id === b.id && resolveBlockAlias(a.type) === resolveBlockAlias(b.type)
  );
}

/** Owned by a split layout; sources include selections before their UI mounts. */
export function createContentInstanceRegistry() {
  const [sources, setSources] = createSignal(
    new Set<() => readonly ContentInstance[]>()
  );
  function find(content: ContentIdentity, excludeOwner?: ContentOwner) {
    for (const source of sources()) {
      const entry = source().find(
        (entry) =>
          entry.owner !== excludeOwner &&
          sameContentIdentity(entry.content, content)
      );
      if (entry) return entry;
    }
  }

  return {
    find,
    register(source: () => readonly ContentInstance[]) {
      setSources((prev) => new Set(prev).add(source));
      return () => {
        setSources((prev) => {
          const next = new Set(prev);
          next.delete(source);
          return next;
        });
      };
    },
    isOpenElsewhere(content: ContentIdentity, owner?: ContentOwner) {
      return find(content, owner) !== undefined;
    },
  };
}
