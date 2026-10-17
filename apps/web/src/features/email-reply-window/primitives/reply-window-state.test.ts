import { createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { createReplyWindowState } from './reply-window-state';

const reply = { threadId: 't1', messageId: 'm1', replyType: 'reply' as const };

it('gives a closed reply back to its thread with the type it was written as', () => {
  createRoot((dispose) => {
    const window = createReplyWindowState();
    window.open(reply);
    expect(window.holds({ threadId: 't1', messageId: 'm1' })).toBe(true);

    window.giveBack('forward');

    expect(window.reply()).toBeUndefined();
    expect(window.returned()).toEqual({ ...reply, replyType: 'forward' });
    expect(window.removed()).toBeUndefined();
    dispose();
  });
});

it('tells threads each time a reply is sent or discarded', () => {
  createRoot((dispose) => {
    const window = createReplyWindowState();
    const removals: unknown[] = [];
    window.open(reply);
    window.finish();
    removals.push(window.removed());
    window.open(reply);
    window.finish();
    removals.push(window.removed());

    expect(removals).toEqual([
      { threadId: 't1', messageId: 'm1' },
      { threadId: 't1', messageId: 'm1' },
    ]);
    // Two separate events, even for the same reply.
    expect(removals[0]).not.toBe(removals[1]);
    expect(window.returned()).toBeUndefined();
    dispose();
  });
});

it('saves the mounted reply before closing, and just closes one still loading', async () => {
  await createRoot(async (dispose) => {
    const window = createReplyWindowState();
    window.open(reply);
    await window.requestClose();
    expect(window.reply()).toBeUndefined();
    expect(window.returned()).toBeUndefined();

    window.open(reply);
    const move = vi.fn(async () => window.giveBack('reply'));
    const unregister = window.registerMove(move);
    await window.requestClose();
    expect(move).toHaveBeenCalledOnce();
    expect(window.returned()).toEqual(reply);

    unregister();
    window.open(reply);
    await window.requestClose();
    expect(move).toHaveBeenCalledOnce();
    dispose();
  });
});
