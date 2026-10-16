import { insertReplyIntoThreadPreview } from '@queries/messages/thread-preview';
import type { Message } from '@service-storage/messages';
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

describe('collapse after live thread replies', () => {
  const liveReplies: Message[] = Array.from({ length: 12 }, (_, index) => ({
    id: `live-reply-${index}`,
    parent: { type: 'channel', id: 'channel' },
    thread_id: 'root',
    sender_id: 'sender',
    content: `Reply ${index + 1}`,
    created_at: new Date(Date.UTC(2026, 8, 24, 9, index)).toISOString(),
    updated_at: new Date(Date.UTC(2026, 8, 24, 9, index)).toISOString(),
    mentions: [],
    attachments: [],
    reactions: [],
  }));

  function liveFixture(loadedInitially: boolean) {
    return createRoot((dispose) => {
      const [thread, setThread] = createSignal({
        preview: liveReplies.slice(0, 3),
        reply_count: 10,
      });
      const [loaded, setLoaded] = createSignal<Message[] | undefined>(
        loadedInitially ? liveReplies.slice(0, 10) : undefined
      );
      const [isExpanded, setExpanded] = createSignal(false);
      const view = createThreadReplyView({
        preview: () => thread().preview,
        loaded,
        isExpanded,
      });
      const receive = (reply: Message) => {
        setThread((current) => insertReplyIntoThreadPreview(current, reply));
        setLoaded((current) => (current ? [...current, reply] : current));
      };
      return { ...view, dispose, receive, setExpanded, setLoaded, thread };
    });
  }

  it('returns to the original preview after replies arrive while expanded', () => {
    const view = liveFixture(true);
    try {
      view.setExpanded(true);
      view.receive(liveReplies[10]);
      view.receive(liveReplies[11]);
      expect(view.displayReplies()).toHaveLength(12);
      view.setExpanded(false);
      expect(view.displayReplies().map((reply) => reply.id)).toEqual(
        liveReplies.slice(0, 3).map((reply) => reply.id)
      );
      expect(view.visibleReplyCount()).toBe(3);
      expect(view.thread().reply_count - view.visibleReplyCount()).toBe(9);
      view.setExpanded(true);
      expect(view.displayReplies()).toEqual(liveReplies);
    } finally {
      view.dispose();
    }
  });

  it('keeps incoming replies hidden while collapsed, including before the full thread loads', () => {
    const view = liveFixture(false);
    try {
      view.receive(liveReplies[10]);
      expect(view.displayReplies()).toEqual(liveReplies.slice(0, 3));
      // The live cache must retain the reply for a fetch racing its arrival.
      expect(view.thread().preview.at(-1)).toEqual(liveReplies[10]);
      view.setLoaded(liveReplies.slice(0, 11));
      expect(view.displayReplies()).toEqual(liveReplies.slice(0, 3));
      view.setExpanded(true);
      expect(view.displayReplies()).toEqual(liveReplies.slice(0, 11));
    } finally {
      view.dispose();
    }
  });

  it('does not reveal live replies after the row remounts from the updated preview cache', () => {
    const updated = insertReplyIntoThreadPreview(
      {
        preview: liveReplies.slice(0, 3),
        reply_count: 10,
      },
      liveReplies[10]
    );
    createRoot((dispose) => {
      try {
        const view = createThreadReplyView({
          preview: () => updated.preview,
          loaded: () => liveReplies.slice(0, 11),
          isExpanded: () => false,
        });
        expect(view.displayReplies()).toEqual(liveReplies.slice(0, 3));
      } finally {
        dispose();
      }
    });
  });
});
