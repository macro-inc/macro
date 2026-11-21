import { type Accessor, createMemo } from 'solid-js';

// Match the timeline's three-reply preview. Live updates append to that cache
// even when older replies are missing, so it is not a complete set of groups.
const COLLAPSED_REPLY_PREVIEW_LIMIT = 3;

/** Full reply data may arrive independently of the user's expansion choice. */
export function createThreadReplyView<T>(options: {
  preview: Accessor<T[]>;
  loaded: Accessor<T[] | undefined>;
  isExpanded: Accessor<boolean>;
  /** Collapse to the indicator alone, as a call's thread does. */
  hideCollapsedPreview?: boolean;
}) {
  const previewCount = () =>
    options.hideCollapsedPreview
      ? 0
      : Math.min(options.preview().length, COLLAPSED_REPLY_PREVIEW_LIMIT);
  const activeReplies = () => options.loaded() ?? options.preview();
  const displayReplies = createMemo(() =>
    options.isExpanded()
      ? activeReplies()
      : options.preview().slice(0, previewCount())
  );
  // An expanded thread whose replies have not arrived shows its preview, and
  // offline a thread the device does not hold never arrives: the count of the
  // rest stays on screen with it.
  const showsPreviewOnly = () =>
    !options.isExpanded() || options.loaded() === undefined;
  return {
    activeReplies,
    displayReplies,
    visibleReplyCount: previewCount,
    showsPreviewOnly,
  };
}
