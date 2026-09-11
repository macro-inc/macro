import type { ListView } from '@app/constants/list-views';
import type {
  SplitContent,
  SplitHandle,
} from '@components/app/split-layout/layoutManager';
import type { EntityData } from '@entity';
import { type Accessor, createSignal, onCleanup } from 'solid-js';

export interface ListNavigationSource {
  viewId: ListView;
  entities: Accessor<EntityData[]>;
  hasMore: Accessor<boolean>;
  loadMore: () => Promise<unknown>;
}

const [sources, setSources] = createSignal(
  new Map<string, ListNavigationSource>()
);

const SOURCE_SPLIT_KEY = 'list.sourceSplitId';

/** Native forward navigation mounts the item in a different split from its list. */
export function listNavigationSourceId(
  handle: Pick<SplitHandle, 'id' | 'content'>
): string {
  const content = handle.content();
  const sourceId = content.state?.[SOURCE_SPLIT_KEY];
  return typeof sourceId === 'string' ? sourceId : handle.id;
}

export function withListNavigationSource(
  content: SplitContent,
  source: Pick<SplitHandle, 'id' | 'content'>
): SplitContent {
  return {
    ...content,
    state: {
      ...content.state,
      [SOURCE_SPLIT_KEY]: listNavigationSourceId(source),
    },
  };
}

/** Keep the list's identity when native swipe-back recreates its split. */
export function registerListNavigationSource(
  handle: Pick<SplitHandle, 'id' | 'content' | 'registerEntryStateCaptor'>,
  source: ListNavigationSource
) {
  const id = listNavigationSourceId(handle);
  onCleanup(handle.registerEntryStateCaptor(SOURCE_SPLIT_KEY, () => id));
  setSources((previous) => new Map(previous).set(id, source));
  onCleanup(() => {
    if (sources().get(id) !== source) return;
    setSources((previous) => {
      const next = new Map(previous);
      next.delete(id);
      return next;
    });
  });
}

export const getListNavigationSource = (id: string) => sources().get(id);
