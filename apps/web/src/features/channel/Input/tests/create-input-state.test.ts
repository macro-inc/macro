import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createInputAttachmentTracker } from '../attachment-tracker';
import { createInputState } from '../create-input-state';

describe('composer reset on send', () => {
  it('clears once through the composer path, while an explicit reset still clears normally', async () => {
    const clearInput = vi.fn();
    const clearComposer = vi.fn();
    const f = createRoot((dispose) => ({
      dispose,
      state: createInputState({
        initialInput: { mode: 'channel', value: 'Message' },
        mentions: () => [],
        attachmentTracker: createInputAttachmentTracker(),
        callbacks: { onSend: vi.fn() },
        clearInput,
        clearComposer,
      }),
    }));
    try {
      await expect(f.state.commands.send()).resolves.toBe(true);
      expect(f.state.view().value).toBe('');
      expect(clearComposer).toHaveBeenCalledOnce();
      expect(clearInput).not.toHaveBeenCalled();
      f.state.reset();
      expect(clearInput).toHaveBeenCalledOnce();
    } finally {
      f.dispose();
    }
  });

  it('uses the ordinary clear when no composer-specific clear is provided', async () => {
    const clearInput = vi.fn();
    const f = createRoot((dispose) => ({
      dispose,
      state: createInputState({
        initialInput: { mode: 'channel', value: 'Message' },
        mentions: () => [],
        attachmentTracker: createInputAttachmentTracker(),
        callbacks: { onSend: vi.fn() },
        clearInput,
      }),
    }));
    try {
      await f.state.commands.send();
      expect(clearInput).toHaveBeenCalledOnce();
    } finally {
      f.dispose();
    }
  });
});

describe('eager send while uploading', () => {
  it('queues a send when attachments are pending', async () => {
    const onSend = vi.fn();
    const f = createRoot((dispose) => {
      const tracker = createInputAttachmentTracker({
        initialAttachments: [
          { id: 'a1', kind: 'image', name: 'photo.png', pending: true },
        ],
      });
      return {
        dispose,
        tracker,
        state: createInputState({
          initialInput: { mode: 'channel', value: 'Here is the image' },
          mentions: () => [],
          attachmentTracker: tracker,
          callbacks: { onSend },
        }),
      };
    });
    try {
      // Attempt to send while upload is pending — queues the send
      await f.state.commands.send();
      expect(onSend).not.toHaveBeenCalled();
      expect(f.tracker.sendQueued()).toBe(true);
    } finally {
      f.dispose();
    }
  });

  it('auto-sends when uploads complete and send was queued', async () => {
    const onSend = vi.fn();
    const f = createRoot((dispose) => {
      const tracker = createInputAttachmentTracker({
        initialAttachments: [
          { id: 'a1', kind: 'image', name: 'photo.png', pending: true },
        ],
      });
      return {
        dispose,
        tracker,
        state: createInputState({
          initialInput: { mode: 'channel', value: 'Here is the image' },
          mentions: () => [],
          attachmentTracker: tracker,
          callbacks: { onSend },
        }),
      };
    });
    try {
      // Queue the send
      await f.state.commands.send();
      expect(onSend).not.toHaveBeenCalled();
      expect(f.tracker.sendQueued()).toBe(true);

      // Simulate upload completing
      f.tracker.setAttachments([
        { id: 'a1', kind: 'image', name: 'photo.png', pending: false },
      ]);

      // Give the effect time to run
      await new Promise((r) => setTimeout(r, 0));
      expect(onSend).toHaveBeenCalledOnce();
      expect(f.tracker.sendQueued()).toBe(false);
    } finally {
      f.dispose();
    }
  });

  it('does not auto-send when send was not queued', async () => {
    const onSend = vi.fn();
    const f = createRoot((dispose) => {
      const tracker = createInputAttachmentTracker({
        initialAttachments: [
          { id: 'a1', kind: 'image', name: 'photo.png', pending: true },
        ],
      });
      return {
        dispose,
        tracker,
        state: createInputState({
          initialInput: { mode: 'channel', value: 'Here is the image' },
          mentions: () => [],
          attachmentTracker: tracker,
          callbacks: { onSend },
        }),
      };
    });
    try {
      // Do NOT queue the send, just simulate upload completing
      f.tracker.setAttachments([
        { id: 'a1', kind: 'image', name: 'photo.png', pending: false },
      ]);

      // Give the effect time to run
      await new Promise((r) => setTimeout(r, 0));
      expect(onSend).not.toHaveBeenCalled();
    } finally {
      f.dispose();
    }
  });

  it('cancels queued send when attachment is removed', async () => {
    const onSend = vi.fn();
    const f = createRoot((dispose) => {
      const tracker = createInputAttachmentTracker({
        initialAttachments: [
          { id: 'a1', kind: 'image', name: 'photo.png', pending: true },
        ],
      });
      return {
        dispose,
        tracker,
        state: createInputState({
          initialInput: { mode: 'channel', value: 'Here is the image' },
          mentions: () => [],
          attachmentTracker: tracker,
          callbacks: { onSend },
        }),
      };
    });
    try {
      // Queue the send
      await f.state.commands.send();
      expect(f.tracker.sendQueued()).toBe(true);

      // Remove the attachment — cancels the queued send
      f.tracker.removeAttachment('a1');
      expect(f.tracker.sendQueued()).toBe(false);
      expect(onSend).not.toHaveBeenCalled();
    } finally {
      f.dispose();
    }
  });
});
