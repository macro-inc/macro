import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { GroupableMessage } from '../../Channel/message-grouping-meta';
import { createThreadReplyView } from '../create-thread-reply-view';

// One sender group used to grow from the three-row preview to all ten replies.
const replies: GroupableMessage[] = Array.from({ length: 10 }, (_, index) => ({
  id: `reply-${index}`,
  sender_id: 'sender',
  created_at: new Date(Date.UTC(2026, 8, 24, 9, index)).toISOString(),
  attachments: [],
  deleted_at: null,
}));
const preview = replies.slice(0, 3);

function fixture(initialLoaded?: GroupableMessage[]) {
  return createRoot((dispose) => {
    const [loaded, setLoaded] = createSignal(initialLoaded);
    const [isExpanded, setExpanded] = createSignal(false);
    const view = createThreadReplyView({
      preview: () => preview,
      loaded,
      isExpanded,
    });
    return { ...view, dispose, setLoaded, setExpanded };
  });
}

describe('thread preview and explicit expansion', () => {
  it('keeps the collapsed preview stable when a background fetch completes', () => {
    const view = fixture();
    try {
      expect(view.displayReplies()).toEqual(preview);
      view.setLoaded(replies);
      expect(view.displayReplies()).toEqual(preview);
      expect(view.visibleReplyCount()).toBe(3);
    } finally {
      view.dispose();
    }
  });

  it('does not reveal a cached full thread on mount or remount', () => {
    for (let mount = 0; mount < 2; mount++) {
      const view = fixture(replies);
      try {
        expect(view.displayReplies()).toEqual(preview);
      } finally {
        view.dispose();
      }
    }
  });

  it('keeps the preview while an explicit expansion loads, then displays all replies', () => {
    const view = fixture();
    try {
      view.setExpanded(true);
      expect(view.displayReplies()).toEqual(preview);
      view.setLoaded(replies);
      expect(view.displayReplies()).toEqual(replies);
      view.setExpanded(false);
      expect(view.displayReplies()).toEqual(preview);
    } finally {
      view.dispose();
    }
  });
});
