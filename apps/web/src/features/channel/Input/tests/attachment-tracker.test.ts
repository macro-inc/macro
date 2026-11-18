/**
 * @vitest-environment jsdom
 */

import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it } from 'vitest';
import { createInputAttachmentTracker } from '../attachment-tracker';
import { makeAttachmentTrackerPersistenceKey } from '../utils/persistence';

describe('input attachment tracker', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('deduplicates by id and tracks pending state', () => {
    createRoot((dispose) => {
      const tracker = createInputAttachmentTracker();

      tracker.addAttachment({ id: 'a1', kind: 'image', name: 'a.png' });
      tracker.addAttachment({ id: 'a1', kind: 'image', name: 'a.png' });
      expect(tracker.attachments()).toHaveLength(1);

      tracker.setAttachmentPending('a1', true);
      expect(tracker.hasPending()).toBe(true);

      tracker.setAttachmentPending('a1', false);
      expect(tracker.hasPending()).toBe(false);

      dispose();
    });
  });

  it('supports explicit add/remove operations', () => {
    createRoot((dispose) => {
      const tracker = createInputAttachmentTracker();

      tracker.addAttachment({ id: 'a1', kind: 'document', name: 'spec.md' });
      expect(tracker.attachments()).toHaveLength(1);

      tracker.removeAttachment('a1');

      expect(tracker.attachments()).toHaveLength(0);
      dispose();
    });
  });

  it('shares the files of one stored draft between inputs', () => {
    const persistenceKey = makeAttachmentTrackerPersistenceKey({
      channelId: 'channel-1',
    });

    createRoot((dispose) => {
      const firstTab = createInputAttachmentTracker({ persistenceKey });
      const secondTab = createInputAttachmentTracker({ persistenceKey });

      firstTab.addAttachment({ id: 'a1', kind: 'image', name: 'a.png' });
      expect(secondTab.attachments()).toEqual([
        { id: 'a1', kind: 'image', name: 'a.png' },
      ]);

      secondTab.removeAttachment('a1');
      expect(firstTab.attachments()).toEqual([]);
      dispose();
    });

    expect(localStorage.getItem(persistenceKey)).toBe('[]');
  });
});
