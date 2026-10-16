import { describe, expect, it, vi } from 'vitest';
import { createInputCommands } from '../create-input-commands';
import type { InputSnapshot } from '../types';

function createMockAttachmentTracker(options?: {
  hasPending?: boolean;
  sendQueued?: boolean;
}) {
  return {
    attachments: () => [],
    hasPending: () => options?.hasPending ?? false,
    sendQueued: () => options?.sendQueued ?? false,
    setSendQueued: vi.fn(),
    addAttachment: vi.fn(),
    removeAttachment: vi.fn(),
    setAttachmentPending: vi.fn(),
    setAttachments: vi.fn(),
    clearAttachments: vi.fn(),
  };
}

describe('createInputCommands', () => {
  it('does not send an empty message', async () => {
    const onSend = vi.fn();
    const tracker = createMockAttachmentTracker();

    const commands = createInputCommands({
      view: () => ({
        mode: 'channel',
        hasPendingAttachments: false,
      }),
      snapshot: () => ({
        value: '   ',
        mentions: [],
        attachments: [],
      }),
      attachmentTracker: tracker,
      setIsSending: vi.fn(),
      setShowFormatRibbon: vi.fn(),
      reset: vi.fn(),
      removeTrackedAttachment: vi.fn(),
      callbacks: {
        onSend,
      },
    });

    await expect(commands.send()).resolves.toBe(false);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('allows attachment-only messages', async () => {
    const onSend = vi.fn();
    const reset = vi.fn();
    const clearComposer = vi.fn();
    const tracker = createMockAttachmentTracker();
    const snapshot: InputSnapshot = {
      value: '   ',
      mentions: [],
      attachments: [
        {
          id: 'attachment-1',
          name: 'image.png',
          kind: 'image',
        },
      ],
    };

    const commands = createInputCommands({
      view: () => ({
        mode: 'channel',
        hasPendingAttachments: false,
      }),
      snapshot: () => snapshot,
      attachmentTracker: tracker,
      setIsSending: vi.fn(),
      setShowFormatRibbon: vi.fn(),
      reset,
      clearComposer,
      removeTrackedAttachment: vi.fn(),
      callbacks: {
        onSend,
      },
    });

    await expect(commands.send()).resolves.toBe(true);
    expect(onSend).toHaveBeenCalledWith(snapshot);
    expect(reset).toHaveBeenCalledOnce();
    expect(clearComposer).toHaveBeenCalledOnce();
  });

  it('resets before invoking onClose', () => {
    const events: string[] = [];
    const tracker = createMockAttachmentTracker();
    const snapshot: InputSnapshot = {
      value: 'reply',
      mentions: [],
      attachments: [],
    };

    const commands = createInputCommands({
      view: () => ({
        mode: 'reply',
        hasPendingAttachments: false,
      }),
      snapshot: () => snapshot,
      attachmentTracker: tracker,
      setIsSending: vi.fn(),
      setShowFormatRibbon: vi.fn(),
      reset: () => {
        events.push('reset');
      },
      removeTrackedAttachment: vi.fn(),
      callbacks: {
        onClose: () => {
          events.push('onClose');
        },
      },
    });

    commands.close();

    expect(events).toEqual(['reset', 'onClose']);
  });

  it('queues send when attachments are pending instead of blocking', async () => {
    const onSend = vi.fn();
    const tracker = createMockAttachmentTracker({ hasPending: true });
    const snapshot: InputSnapshot = {
      value: 'hello',
      mentions: [],
      attachments: [{ id: '1', name: 'img.png', kind: 'image', pending: true }],
    };

    const commands = createInputCommands({
      view: () => ({
        mode: 'channel',
        hasPendingAttachments: true,
      }),
      snapshot: () => snapshot,
      attachmentTracker: tracker,
      setIsSending: vi.fn(),
      setShowFormatRibbon: vi.fn(),
      reset: vi.fn(),
      removeTrackedAttachment: vi.fn(),
      callbacks: { onSend },
    });

    await expect(commands.send()).resolves.toBe(false);
    expect(tracker.setSendQueued).toHaveBeenCalledWith(true);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('clears queued state when send completes', async () => {
    const onSend = vi.fn();
    const tracker = createMockAttachmentTracker({ hasPending: false });
    const snapshot: InputSnapshot = {
      value: 'hello',
      mentions: [],
      attachments: [{ id: '1', name: 'img.png', kind: 'image' }],
    };

    const commands = createInputCommands({
      view: () => ({
        mode: 'channel',
        hasPendingAttachments: false,
      }),
      snapshot: () => snapshot,
      attachmentTracker: tracker,
      setIsSending: vi.fn(),
      setShowFormatRibbon: vi.fn(),
      reset: vi.fn(),
      removeTrackedAttachment: vi.fn(),
      callbacks: { onSend },
    });

    await commands.send();
    expect(tracker.setSendQueued).toHaveBeenCalledWith(false);
    expect(onSend).toHaveBeenCalledWith(snapshot);
  });
});
