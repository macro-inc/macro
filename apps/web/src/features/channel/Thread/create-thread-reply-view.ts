import { type Accessor, createMemo } from 'solid-js';
import type { GroupableMessage } from '../Channel/message-grouping-meta';
import { getVisibleReplyCount } from './utils/thread-reply-indicator-helpers';

/** Full reply data may arrive independently of the user's expansion choice. */
export function createThreadReplyView<T extends GroupableMessage>(options: {
  preview: Accessor<T[]>;
  loaded: Accessor<T[] | undefined>;
  isExpanded: Accessor<boolean>;
}) {
  const previewCount = createMemo(() =>
    getVisibleReplyCount(options.preview())
  );
  const activeReplies = () => options.loaded() ?? options.preview();
  const displayReplies = createMemo(() =>
    options.isExpanded()
      ? activeReplies()
      : options.preview().slice(0, previewCount())
  );
  return { activeReplies, displayReplies, visibleReplyCount: previewCount };
}
