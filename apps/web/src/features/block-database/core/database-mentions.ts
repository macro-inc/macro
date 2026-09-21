import type { DatabaseMention } from './column-inference';

export type DatabaseMentionCandidate = DatabaseMention & {
  description?: string;
};

export type DatabaseMentionSource = {
  items: () => DatabaseMentionCandidate[];
  loading: () => boolean;
  loadingMore: () => boolean;
  hasMore: () => boolean;
  loadMore: () => Promise<void>;
};
