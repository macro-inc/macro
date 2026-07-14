import { describe, expect, it, vi } from 'vitest';
import { createInputCommands } from '../create-input-commands';
import type { InputSnapshot } from '../types';

describe('createInputCommands', () => {
  it('does not send an empty message', async () => {
    const onSend = vi.fn();

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
});
