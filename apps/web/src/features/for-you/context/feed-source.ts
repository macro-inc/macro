import type { Accessor } from 'solid-js';
import type { FeedItem } from '../core/feed';

export type FeedSource = {
  items: Accessor<FeedItem[] | undefined>;
  loading: Accessor<boolean>;
  refreshing: Accessor<boolean>;
  error: Accessor<string | undefined>;
  canRetry: Accessor<boolean>;
  refresh: () => Promise<void>;
};
export type FeedPreferences = {
  prompt: Accessor<string>;
  hiddenIds: Accessor<string[]>;
  setPrompt: (value: string) => void;
  setHiddenIds: (value: string[]) => void;
};
export type FeedActions = {
  start: (item: FeedItem) => Promise<void>;
  openSource: (item: FeedItem) => void;
};
