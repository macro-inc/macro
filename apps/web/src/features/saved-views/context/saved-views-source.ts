import type { Accessor } from 'solid-js';
import type { SavedView } from '../core/saved-view';

/** A paginated list of accessible definitions, independent of selection. */
export type SavedViewsSource = {
  items: Accessor<readonly SavedView[] | undefined>;
  error: Accessor<unknown>;
  loading: Accessor<boolean>;
  hasMore: Accessor<boolean>;
  loadingMore: Accessor<boolean>;
  loadMore: () => Promise<unknown>;
  refresh: () => Promise<unknown>;
};

/** Undefined data means loading; null means the definition is unavailable. */
export type SavedViewSource = {
  data: Accessor<SavedView | null | undefined>;
  /** Viewer identity returned with the current data, not the requested identity. */
  viewerId: Accessor<string | undefined>;
  error: Accessor<unknown>;
  loading: Accessor<boolean>;
  refresh: () => Promise<unknown>;
};
