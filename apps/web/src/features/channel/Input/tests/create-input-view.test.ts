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

  it('keeps inputs mounted on one draft in step', () => {
    const persistenceKey = makeInputValuePersistenceKey({
      channelId: 'channel-1',
    });
    const mount = () =>
      createInputView({
        initialInput: { mode: 'channel', value: '' },
        mentions: () => [],
        attachmentTracker: createInputAttachmentTracker(),
        persistenceKey,
      });

    createRoot((dispose) => {
      const firstTab = mount();
      const secondTab = mount();

      firstTab.setValue('typed in the first tab');
      expect(secondTab.value()).toBe('typed in the first tab');

      secondTab.setValue('typed in the first tab, then the second');
      expect(firstTab.value()).toBe('typed in the first tab, then the second');

      firstTab.reset();
      expect(secondTab.value()).toBe('');
      dispose();
    });
  });

  it('reads storage again once no input holds the draft', () => {
    const persistenceKey = makeInputValuePersistenceKey({
      channelId: 'channel-1',
    });
    const mount = () =>
      createInputView({
        initialInput: { mode: 'channel', value: '' },
        mentions: () => [],
        attachmentTracker: createInputAttachmentTracker(),
        persistenceKey,
      });

    const firstTab = createRoot((dispose) => ({ view: mount(), dispose }));
    createRoot((dispose) => {
      mount().setValue('typed in the second tab');
      dispose();
    });
    expect(firstTab.view.value()).toBe('typed in the second tab');
    firstTab.dispose();

    localStorage.setItem(persistenceKey, JSON.stringify('written elsewhere'));
    createRoot((dispose) => {
      expect(mount().value()).toBe('written elsewhere');
      dispose();
    });
  });
});
