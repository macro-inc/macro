import { batch, createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import type { EmailMessage } from '../../email-message/core/email-message';
import { message } from '../tests/fixtures';
import { createThreadReplyArea } from './thread-reply-area';

const disposers: (() => void)[] = [];
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));

function setup(touch: boolean) {
  return createRoot((dispose) => {
    disposers.push(dispose);
    const parent = message('parent');
    const draft = message('draft', {
      is_draft: true,
      replying_to_id: 'parent',
    });
    const [threadId, setThreadId] = createSignal('first');
    const [messages, setMessages] = createSignal([parent]);
    const [allMessages, setAllMessages] = createSignal([parent, draft]);
    const [drafts, setDrafts] = createSignal<Record<string, EmailMessage>>({
      parent: draft,
    });
    const [owner, setOwner] = createSignal(true);
    const [settled, setSettled] = createSignal(true);
    const [bottomOpen, setBottomOpen] = createSignal(false);
    const [mobileId, setMobileId] = createSignal<string>();
    const area = createThreadReplyArea({
      threadId,
      isTouch: () => touch,
      messages,
      allMessages,
      canCompose: owner,
      drafts: {
        getDraftForMessage: (id) => drafts()[id],
        initialDraftsSettled: settled,
      },
      bottomReply: { open: bottomOpen, setOpen: setBottomOpen },
      mobileReply: {
        open: () => mobileId() !== undefined,
        openForMessage: setMobileId,
        close: () => setMobileId(undefined),
      },
    });
    return {
      area,
      draft,
      bottomOpen,
      mobileId,
      setThreadId,
      setMessages,
      setAllMessages,
      setDrafts,
      setOwner,
      setSettled,
    };
  });
}

describe('thread reply placement', () => {
  it.each([false, true])(
    'opens cached drafts without the thread reset overriding them (touch=%s)',
    (touch) => {
      const state = setup(touch);
      expect(state.bottomOpen()).toBe(!touch);
      expect(state.mobileId()).toBe(touch ? 'parent' : undefined);
      const next = message('next');
      const nextDraft = message('next-draft', {
        is_draft: true,
        replying_to_id: 'next',
      });
      batch(() => {
        state.setThreadId('second');
        state.setMessages([next]);
        state.setAllMessages([next, nextDraft]);
        state.setDrafts({ next: nextDraft });
      });
      expect(state.area.info()?.draft?.db_id).toBe('next-draft');
      expect(state.bottomOpen()).toBe(!touch);
      expect(state.mobileId()).toBe(touch ? 'next' : undefined);
      batch(() => {
        state.setThreadId('third');
        state.setDrafts({});
      });
      expect(state.bottomOpen()).toBe(false);
      expect(state.mobileId()).toBeUndefined();
    }
  );

  it('uses draft-only threads while respecting ownership and settlement gates', () => {
    const state = setup(false);
    state.setMessages([]);
    state.setAllMessages([state.draft]);
    expect(state.area.info()).toEqual({
      replyingTo: undefined,
      draft: state.draft,
    });
    expect(state.area.inFlow()).toBe(true);
    state.setOwner(false);
    expect(state.area.inFlow()).toBe(false);
    state.setOwner(true);
    state.setSettled(false);
    expect(state.area.inFlow()).toBe(false);
    state.setAllMessages([]);
    expect(state.area.info()).toBeUndefined();
  });
});
