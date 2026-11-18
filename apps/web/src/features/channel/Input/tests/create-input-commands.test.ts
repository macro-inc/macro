import { hapticImpact } from '@core/mobile/haptics';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInputCommands } from '../create-input-commands';
import type { InputSnapshot } from '../types';

vi.mock('@core/mobile/haptics', () => ({ hapticImpact: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

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
    expect(hapticImpact).not.toHaveBeenCalled();
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
    expect(hapticImpact).toHaveBeenCalledExactlyOnceWith('light');
    expect(reset).toHaveBeenCalledOnce();
    expect(clearComposer).toHaveBeenCalledOnce();
  });

  it('clears the draft before the message is delivered and restores it when send fails', async () => {
    let value = 'Hello agent';
    let duringSend = 'unset';
    const snapshot = (): InputSnapshot => ({
      value,
      mentions: [],
      attachments: [],
    });
    const commands = createInputCommands({
      view: () => ({
        mode: 'channel',
        hasPendingAttachments: false,
      }),
      snapshot,
      setIsSending: vi.fn(),
      setShowFormatRibbon: vi.fn(),
      reset: () => {
        value = '';
      },
      restoreSnapshot: (next) => {
        value = next.value;
      },
      clearComposer: vi.fn(),
      removeTrackedAttachment: vi.fn(),
      callbacks: {
        onSend: async () => {
          duringSend = value;
          throw new Error('offline');
        },
      },
    });

    await expect(commands.send()).rejects.toThrow('offline');
    expect(duringSend).toBe('');
    expect(value).toBe('Hello agent');
  });

  it.each([
    ['a list left with Enter', '1. one\n2. two\n\n \n', '1. one\n2. two'],
    ['several empty paragraphs', 'hello\n\n \n\n \n', 'hello'],
    ['blank lines between paragraphs', 'one\n\n \n\ntwo', 'one\n\n \n\ntwo'],
  ])('sends %s without blank lines at its end', async (_name, value, sent) => {
    const onSend = vi.fn();
    const commands = createInputCommands({
      view: () => ({ mode: 'channel', hasPendingAttachments: false }),
      snapshot: () => ({ value, mentions: [], attachments: [] }),
      setIsSending: vi.fn(),
      setShowFormatRibbon: vi.fn(),
      reset: vi.fn(),
      removeTrackedAttachment: vi.fn(),
      callbacks: { onSend },
    });

    await expect(commands.send()).resolves.toBe(true);
    expect(onSend).toHaveBeenCalledExactlyOnceWith({
      value: sent,
      mentions: [],
      attachments: [],
    });
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
