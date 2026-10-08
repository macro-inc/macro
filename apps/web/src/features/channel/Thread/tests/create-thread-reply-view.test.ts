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

function fixture(
  initialLoaded?: GroupableMessage[],
  collapsedReplyPreview?: 'latest-two'
) {
  return createRoot((dispose) => {
    const [loaded, setLoaded] = createSignal(initialLoaded);
    const [isExpanded, setExpanded] = createSignal(false);
    const view = createThreadReplyView({
      preview: () => preview,
      loaded,
      isExpanded,
      collapsedReplyPreview,
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

describe('latest-two reply previews', () => {
  it('shows exactly the latest two replies even when one sender wrote all replies', () => {
    const view = fixture(replies, 'latest-two');
    try {
      expect(view.displayReplies()).toEqual(replies.slice(-2));
      expect(view.visibleReplyCount()).toBe(2);
      view.setExpanded(true);
      expect(view.displayReplies()).toEqual(replies);
      view.setExpanded(false);
      expect(view.displayReplies()).toEqual(replies.slice(-2));
    } finally {
      view.dispose();
    }
  });

  it('uses the latest preview replies before the full thread loads', () => {
    const view = fixture(undefined, 'latest-two');
    try {
      expect(view.displayReplies()).toEqual(preview.slice(-2));
      view.setLoaded(replies);
      expect(view.displayReplies()).toEqual(replies.slice(-2));
    } finally {
      view.dispose();
    }
  });

  it('includes new replies in a collapsed preview without expanding', () => {
    const view = fixture(replies, 'latest-two');
    try {
      const updatedReplies = [...replies, { ...replies[0], id: 'new-reply' }];
      view.setLoaded(updatedReplies);
      expect(view.displayReplies()).toEqual(updatedReplies.slice(-2));
    } finally {
      view.dispose();
    }
  });

  it.each([0, 1, 2])('shows all replies when only %i exist', (count) => {
    const view = fixture(replies.slice(0, count), 'latest-two');
    try {
      expect(view.displayReplies()).toEqual(replies.slice(0, count));
      expect(view.visibleReplyCount()).toBe(count);
    } finally {
      view.dispose();
    }
  });
});
