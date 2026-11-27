/**
 * @vitest-environment jsdom
 */

import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it } from 'vitest';
import type { MessageData } from '../../Message';
import { replyTargetStorage } from '../reply-target-storage';
import { createUnifiedInputManager } from '../unified-input-manager';

const root = { id: 'root-1', thread_id: null } as MessageData;
const reply = { id: 'reply-1', thread_id: 'root-1' } as MessageData;

/** One mount of the channel's unified input, with the drafts given. */
function mount(
  drafted: string[],
  options?: { initialReplyTarget?: { threadId: string; replyId?: string } }
) {
  return createRoot((dispose) => ({
    manager: createUnifiedInputManager({
      ...options,
      storage: replyTargetStorage('channel-1', (threadId) =>
        drafted.includes(threadId)
      ),
    }),
    dispose,
  }));
}

describe('replyTargetStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('brings a reply with a draft back when the channel opens again', () => {
    const first = mount([]);
    first.manager.bindReply(reply);
    first.dispose();

    const second = mount(['root-1']);
    expect(second.manager.replyTarget()).toEqual({
      threadId: 'root-1',
      replyId: 'reply-1',
    });
    second.dispose();
  });

  it('does not bring back a reply with nothing written', () => {
    const first = mount([]);
    first.manager.bindReply(root);
    first.dispose();

    const second = mount([]);
    expect(second.manager.replyTarget()).toBeUndefined();
    second.dispose();
  });

  it('forgets a reply once it is closed or sent', () => {
    const first = mount([]);
    first.manager.bindReply(root);
    first.manager.closeReply();
    first.dispose();

    const second = mount(['root-1']);
    expect(second.manager.replyTarget()).toBeUndefined();
    second.dispose();
  });

  it('keeps each channel to its own reply', () => {
    const first = mount([]);
    first.manager.bindReply(root);
    first.dispose();

    const other = createRoot((dispose) => {
      const manager = createUnifiedInputManager({
        storage: replyTargetStorage('channel-2', () => true),
      });
      const target = manager.replyTarget();
      dispose();
      return target;
    });
    expect(other).toBeUndefined();
  });

  it('leaves a binding from the history snapshot in place', () => {
    const first = mount([]);
    first.manager.bindReply(root);
    first.dispose();

    const second = mount(['root-1', 'root-2'], {
      initialReplyTarget: { threadId: 'root-2' },
    });
    expect(second.manager.replyTarget()).toEqual({ threadId: 'root-2' });
    second.dispose();
  });

  it('keeps the reply the same channel open elsewhere stored when this one closes', () => {
    const here = mount([]);
    here.manager.bindReply(root);
    const elsewhere = mount([]);
    elsewhere.manager.bindReply({
      id: 'root-2',
      thread_id: null,
    } as MessageData);
    here.manager.closeReply();
    here.dispose();
    elsewhere.dispose();

    const again = mount(['root-2']);
    expect(again.manager.replyTarget()).toEqual({ threadId: 'root-2' });
    again.dispose();
  });

  it('forgets a reply closed here that is open elsewhere too, since it is the same reply', () => {
    const here = mount([]);
    here.manager.bindReply(root);
    const elsewhere = mount([]);
    elsewhere.manager.bindReply(root);
    here.manager.closeReply();
    here.dispose();
    elsewhere.dispose();

    const again = mount(['root-1']);
    expect(again.manager.replyTarget()).toBeUndefined();
    again.dispose();
  });

  it('forgets a reply the history snapshot brought back once it is closed', () => {
    const first = mount([]);
    first.manager.bindReply(root);
    first.dispose();
    const fromHistory = mount(['root-1'], {
      initialReplyTarget: { threadId: 'root-1' },
    });
    fromHistory.manager.closeReply();
    fromHistory.dispose();

    const again = mount(['root-1']);
    expect(again.manager.replyTarget()).toBeUndefined();
    again.dispose();
  });

  it('ignores a stored binding it cannot read', () => {
    localStorage.setItem('channel-reply-target:channel-1', '{"threadId":');
    const second = mount(['root-1']);
    expect(second.manager.replyTarget()).toBeUndefined();
    second.dispose();
  });
});
