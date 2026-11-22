import type { TagMentionLifecycle } from '../../plugins/tags/tagsPlugin';

/** Model capabilities used by the shared tags menu. */
export interface TagsMenuHost {
  root(): HTMLElement | null;
  /** Collapse the search back into plain text. */
  closeSearch(): void;
  /** Remove the search first, then insert the tag at the current selection. */
  insertTag(tag: TagMentionLifecycle): void;
}
