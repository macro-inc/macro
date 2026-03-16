import { describe, expect, it, vi } from 'vitest';
import { createInputCommands } from '../create-input-commands';
import type { InputSnapshot } from '../types';

describe('createInputCommands', () => {
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
