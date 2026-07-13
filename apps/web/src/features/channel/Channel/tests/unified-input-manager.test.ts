import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { MessageData } from '../../Message';
import { createUnifiedInputManager } from '../unified-input-manager';

const root = { id: 'root-1', thread_id: null } as MessageData;
const reply = { id: 'reply-1', thread_id: 'root-1' } as MessageData;
const otherRoot = { id: 'root-2', thread_id: null } as MessageData;

describe('createUnifiedInputManager', () => {
  it('binds a root message as a root-bound pointer', () => {
    createRoot((dispose) => {
      const manager = createUnifiedInputManager();

      manager.bindReply(root);

      expect(manager.replyTarget()).toEqual({
        threadId: 'root-1',
        replyId: undefined,
        message: root,
      });

      dispose();
    });
  });

  it('binds a thread reply as a reply-bound pointer to its root thread', () => {
    createRoot((dispose) => {
      const manager = createUnifiedInputManager();

      manager.bindReply(reply);

      expect(manager.replyTarget()).toEqual({
        threadId: 'root-1',
        replyId: 'reply-1',
        message: reply,
      });

      dispose();
    });
  });

  it('releases the previous thread when the binding moves to another thread', () => {
    createRoot((dispose) => {
      const released: string[] = [];
      const manager = createUnifiedInputManager({
        onReplyThreadReleased: (threadId) => released.push(threadId),
      });

      manager.bindReply(root);
      // Rebinding within the same thread is not a release.
      manager.bindReply(reply);
      expect(released).toEqual([]);

      manager.bindReply(otherRoot);
      expect(released).toEqual(['root-1']);

      manager.closeReply();
      expect(released).toEqual(['root-1', 'root-2']);
      expect(manager.replyTarget()).toBeUndefined();

      dispose();
    });
  });

  it('closeReply without a binding is a no-op', () => {
    createRoot((dispose) => {
      const released: string[] = [];
      const manager = createUnifiedInputManager({
        onReplyThreadReleased: (threadId) => released.push(threadId),
      });

      manager.closeReply();

      expect(released).toEqual([]);

      dispose();
    });
  });

  it('restores an id-only binding from a snapshot', () => {
    createRoot((dispose) => {
      const manager = createUnifiedInputManager({
        initialReplyTarget: { threadId: 'root-1', replyId: 'reply-1' },
      });

      expect(manager.replyTarget()).toEqual({
        threadId: 'root-1',
        replyId: 'reply-1',
      });
      expect(manager.replyTarget()?.message).toBeUndefined();

      dispose();
    });
  });

  it('snapshots the binding by ids only, never the entity', () => {
    createRoot((dispose) => {
      const manager = createUnifiedInputManager();

      expect(manager.getReplyTargetSnapshot()).toBeUndefined();

      manager.bindReply(reply);

      expect(manager.getReplyTargetSnapshot()).toEqual({
        threadId: 'root-1',
        replyId: 'reply-1',
      });

      dispose();
    });
  });
});
