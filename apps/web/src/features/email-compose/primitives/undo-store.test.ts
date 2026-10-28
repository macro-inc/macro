import { describe, expect, it, vi } from 'vitest';
import { createEmailUndoStore } from './undo-store';

describe('independent undo recovery', () => {
  it('keeps concurrent drafts and live replies separate', () => {
    const store = createEmailUndoStore<{ draftId: string; html: string }>();
    const a = { draftId: 'a', html: 'First' };
    const b = { draftId: 'b', html: 'Second' };
    const first = vi.fn();
    const second = vi.fn();
    store.remember(a);
    store.remember(b);
    const cleanupA = store.register('thread-a:reply', first);
    store.register('thread-b:reply', second);
    store.restore('thread-a:reply', store.take('a')!);
    expect(first).toHaveBeenCalledWith(a);
    expect(second).not.toHaveBeenCalled();
    cleanupA();
    store.restore('thread-b:reply', store.take('b')!);
    expect(second).toHaveBeenCalledWith(b);
  });
  it('queues remount recovery and does not let an older owner remove a new registration', () => {
    const store = createEmailUndoStore<{ draftId: string }>();
    const snapshot = { draftId: 'draft' };
    store.restore('thread:reply', snapshot);
    expect(store.takePending('unrelated')).toBeUndefined();
    expect(store.takePending('thread:reply')).toBe(snapshot);
    expect(store.takePending('thread:reply')).toBeUndefined();
    const old = store.register('thread:reply', vi.fn());
    const current = vi.fn();
    store.register('thread:reply', current);
    old();
    store.restore('thread:reply', snapshot);
    expect(current).toHaveBeenCalledWith(snapshot);
  });
});
