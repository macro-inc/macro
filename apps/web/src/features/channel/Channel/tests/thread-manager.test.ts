import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createThreadManager } from '../thread-manager';

describe('createThreadManager', () => {
  it('hydrates thread state from a snapshot', () => {
    createRoot((dispose) => {
      const manager = createThreadManager({
        expanded: { isExpanded: true },
        replying: {
          isReplying: true,
        },
      });

      const expanded = manager.getOrCreateThreadState('expanded');
      const replying = manager.getOrCreateThreadState('replying');

      expect(expanded.isExpanded()).toBe(true);
      expect(expanded.isReplying()).toBe(false);
      expect(replying.isExpanded()).toBe(true);
      expect(replying.isReplying()).toBe(true);

      dispose();
    });
  });

  it('serializes only non-default thread state', () => {
    createRoot((dispose) => {
      const replyInputState = {
        value: 'draft reply',
        mentions: [],
        attachments: [],
      };
      const manager = createThreadManager({
        replying: {
          isReplying: true,
        },
      });

      manager.getOrCreateThreadState('default');
      manager.getOrCreateThreadState('expanded').setIsExpanded(true);
      manager
        .getOrCreateThreadState('draft')
        .setReplyInputState(replyInputState);

      expect(manager.getSnapshot()).toEqual({
        replying: {
          isReplying: true,
        },
        expanded: {
          isExpanded: true,
        },
      });

      dispose();
    });
  });

  it('clears restored thread state after a materialized thread returns to defaults', () => {
    createRoot((dispose) => {
      const manager = createThreadManager({
        expanded: { isExpanded: true },
      });

      manager.getOrCreateThreadState('expanded').setIsExpanded(false);

      expect(manager.getSnapshot()).toBeUndefined();

      dispose();
    });
  });

  it('opens the reply of a thread with a stored draft', () => {
    createRoot((dispose) => {
      const manager = createThreadManager(undefined, {
        hasReplyDraft: (threadId) => threadId === 'drafted',
      });

      const drafted = manager.getOrCreateThreadState('drafted');
      const other = manager.getOrCreateThreadState('other');

      expect(drafted.isReplying()).toBe(true);
      expect(drafted.isExpanded()).toBe(true);
      expect(other.isReplying()).toBe(false);
      expect(other.isExpanded()).toBe(false);
      expect(manager.getSnapshot()).toEqual({
        drafted: { isExpanded: true, isReplying: true },
      });

      dispose();
    });
  });

  it('keeps a history snapshot that says replying, without a draft', () => {
    createRoot((dispose) => {
      const asked: string[] = [];
      const manager = createThreadManager(
        { replying: { isReplying: true }, expanded: { isExpanded: true } },
        {
          hasReplyDraft: (threadId) => {
            asked.push(threadId);
            return false;
          },
        }
      );

      expect(manager.getOrCreateThreadState('replying').isReplying()).toBe(
        true
      );
      expect(manager.getOrCreateThreadState('expanded').isReplying()).toBe(
        false
      );
      expect(asked).toEqual(['expanded']);

      dispose();
    });
  });
});
