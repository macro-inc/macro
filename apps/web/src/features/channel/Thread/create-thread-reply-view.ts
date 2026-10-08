import { type Accessor, createMemo } from 'solid-js';
import type { GroupableMessage } from '../Channel/message-grouping-meta';
import { getVisibleReplyCount } from './utils/thread-reply-indicator-helpers';

/** Full reply data may arrive independently of the user's expansion choice. */
export function createThreadReplyView<T extends GroupableMessage>(options: {
  preview: Accessor<T[]>;
  loaded: Accessor<T[] | undefined>;
  isExpanded: Accessor<boolean>;
  /** Latest-two previews do not use sender grouping to choose visible replies. */
  collapsedReplyPreview?: 'latest-two';
}) {
  const previewReplies = createMemo(() =>
    options.collapsedReplyPreview === 'latest-two'
      ? (options.loaded() ?? options.preview()).slice(-2)
      : options.preview().slice(0, getVisibleReplyCount(options.preview()))
  );
  const activeReplies = () => options.loaded() ?? options.preview();
  const displayReplies = createMemo(() =>
    options.isExpanded() ? activeReplies() : previewReplies()
  );
  const visibleReplyCount = () => previewReplies().length;
  return { activeReplies, displayReplies, visibleReplyCount };
}
