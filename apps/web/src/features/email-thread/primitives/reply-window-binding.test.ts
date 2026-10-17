import { type Accessor, createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { createReplyWindowState } from '../../email-reply-window/primitives/reply-window-state';
import { createReplyWindowBinding } from './reply-window-binding';

const target = { threadId: 't1', messageId: 'm1' };

/** A thread's message bound to the window; effects run once this returns. */
function bind(
  window: ReturnType<typeof createReplyWindowState>,
  available: Accessor<boolean> = () => true
) {
  return createRoot((dispose) => {
    const [requested, setRequested] = createSignal(false);
    const openInline = vi.fn();
    const dropDraft = vi.fn();
    const binding = createReplyWindowBinding({
      replyWindow: () => (available() ? window : undefined),
      target: () => target,
      replyRequested: requested,
      clearReplyRequest: () => setRequested(false),
      openInline,
      dropDraft,
    });
    return { binding, setRequested, requested, openInline, dropDraft, dispose };
  });
}

it('stands in for the reply while the window holds it, and reply keys show the window', () => {
  const window = createRoot(createReplyWindowState);
  const { binding, setRequested, requested, dispose } = bind(window);
  binding.popOut()?.('reply-all');
  expect(binding.inWindow()).toBe(true);
  const focusRequest = window.focusRequest();

  setRequested(true);

  expect(requested()).toBe(false);
  expect(window.focusRequest()).toBe(focusRequest + 1);
  dispose();
});

it('reopens a reply the window gives back and drops one it sent', () => {
  const window = createRoot(createReplyWindowState);
  const { binding, openInline, dropDraft, dispose } = bind(window);
  binding.popOut()?.('reply-all');
  window.giveBack('reply-all');
  expect(binding.inWindow()).toBe(false);
  expect(openInline).toHaveBeenCalledWith('reply-all');
  expect(window.returned()).toBeUndefined();

  binding.popOut()?.('reply-all');
  window.finish();
  expect(dropDraft).toHaveBeenCalledOnce();
  expect(openInline).toHaveBeenCalledOnce();
  dispose();
});

it('ignores hand-offs that happened before the thread opened', () => {
  const window = createRoot(createReplyWindowState);
  window.open({ ...target, replyType: 'reply' });
  window.finish();
  window.open({ ...target, replyType: 'reply' });
  window.giveBack('reply');

  // The thread opens later, with a newer draft for the same message.
  const { openInline, dropDraft, dispose } = bind(window);

  expect(openInline).not.toHaveBeenCalled();
  expect(dropDraft).not.toHaveBeenCalled();
  dispose();
});

it('follows the window becoming unavailable, as when the device turns touch', () => {
  const window = createRoot(createReplyWindowState);
  const [available, setAvailable] = createSignal(true);
  const { binding, setRequested, requested, dispose } = bind(window, available);
  binding.popOut()?.('reply');
  expect(binding.inWindow()).toBe(true);

  setAvailable(false);

  expect(binding.inWindow()).toBe(false);
  expect(binding.popOut()).toBeUndefined();
  setRequested(true);
  expect(requested()).toBe(true);
  dispose();
});
