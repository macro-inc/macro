import type { EntityData, WithNotification } from '@entity';
import type { Accessor } from 'solid-js';

/** The documents the Artifacts list reads, newest first, and their paging. */
export type ArtifactListSource = {
  documents: Accessor<readonly WithNotification<EntityData>[]>;
  /** The first page is still loading. */
  loading: Accessor<boolean>;
  /** The list itself failed; a failed continuation page is `loadMoreFailed`. */
  failed: Accessor<boolean>;
  hasMore: Accessor<boolean>;
  loadingMore: Accessor<boolean>;
  loadMoreFailed: Accessor<boolean>;
  loadMore(): Promise<void>;
  retry(): Promise<void>;
};
