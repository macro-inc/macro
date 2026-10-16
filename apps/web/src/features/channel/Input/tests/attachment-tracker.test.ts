/**
 * @vitest-environment jsdom
 */

import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createInputAttachmentTracker } from '../attachment-tracker';

describe('input attachment tracker', () => {
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

  it('tracks sendQueued state', () => {
    createRoot((dispose) => {
      const tracker = createInputAttachmentTracker();
      expect(tracker.sendQueued()).toBe(false);

      tracker.setSendQueued(true);
      expect(tracker.sendQueued()).toBe(true);

      tracker.setSendQueued(false);
      expect(tracker.sendQueued()).toBe(false);

      dispose();
    });
  });

  it('clears sendQueued when an attachment is removed', () => {
    createRoot((dispose) => {
      const tracker = createInputAttachmentTracker();

      tracker.addAttachment({
        id: 'a1',
        kind: 'image',
        name: 'a.png',
        pending: true,
      });
      tracker.setSendQueued(true);
      expect(tracker.sendQueued()).toBe(true);

      tracker.removeAttachment('a1');
      expect(tracker.sendQueued()).toBe(false);

      dispose();
    });
  });

  it('clears sendQueued when attachments are cleared', () => {
    createRoot((dispose) => {
      const tracker = createInputAttachmentTracker();

      tracker.addAttachment({
        id: 'a1',
        kind: 'image',
        name: 'a.png',
        pending: true,
      });
      tracker.setSendQueued(true);
      expect(tracker.sendQueued()).toBe(true);

      tracker.clearAttachments();
      expect(tracker.sendQueued()).toBe(false);

      dispose();
    });
  });
});
