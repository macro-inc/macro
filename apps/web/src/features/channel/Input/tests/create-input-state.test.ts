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
