/**
 * @vitest-environment jsdom
 */

import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it } from 'vitest';
import { createInputAttachmentTracker } from '../attachment-tracker';
import { createInputView } from '../create-input-view';
import { makeInputValuePersistenceKey } from '../utils/persistence';

describe('createInputView', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('rehydrates the persisted input value for the same key', () => {
    const persistenceKey = makeInputValuePersistenceKey({
      channelId: 'channel-1',
    });

    createRoot((dispose) => {
      const view = createInputView({
        initialInput: {
          mode: 'channel',
          value: '',
        },
        mentions: () => [],
        attachmentTracker: createInputAttachmentTracker(),
        persistenceKey,
      });

      view.setValue('persisted value');
      expect(view.value()).toBe('persisted value');
      dispose();
    });

    createRoot((dispose) => {
      const view = createInputView({
        initialInput: {
          mode: 'channel',
          value: '',
        },
        mentions: () => [],
        attachmentTracker: createInputAttachmentTracker(),
        persistenceKey,
      });

      expect(view.value()).toBe('persisted value');
      dispose();
    });
  });

  it('removes the persisted value when the input becomes empty', () => {
    const persistenceKey = makeInputValuePersistenceKey({
      channelId: 'channel-1',
    });

    createRoot((dispose) => {
      const view = createInputView({
        initialInput: {
          mode: 'channel',
          value: '',
        },
        mentions: () => [],
        attachmentTracker: createInputAttachmentTracker(),
        persistenceKey,
      });

      view.setValue('persisted value');
      view.setValue('');
      dispose();
    });

    expect(localStorage.getItem(persistenceKey)).toBeNull();

    createRoot((dispose) => {
      const view = createInputView({
        initialInput: {
          mode: 'channel',
          value: '',
        },
        mentions: () => [],
        attachmentTracker: createInputAttachmentTracker(),
        persistenceKey,
      });

      expect(view.value()).toBe('');
      dispose();
    });
  });
});
