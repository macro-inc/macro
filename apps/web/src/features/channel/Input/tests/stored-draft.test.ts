/**
 * @vitest-environment jsdom
 */

import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it } from 'vitest';
import { createInputAttachmentTracker } from '../attachment-tracker';
import { holdPersistedDraftText } from '../shared-draft';
import { hasStoredDraft } from '../stored-draft';
import {
  makeAttachmentTrackerPersistenceKey,
  makeInputValuePersistenceKey,
} from '../utils/persistence';

const THREAD = { channelId: 'channel:channel-1', threadId: 'root-1' };

describe('hasStoredDraft', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('finds stored text, and only for its own thread', () => {
    localStorage.setItem(
      makeInputValuePersistenceKey(THREAD),
      JSON.stringify('half a reply')
    );

    expect(hasStoredDraft(THREAD)).toBe(true);
    expect(hasStoredDraft({ ...THREAD, threadId: 'root-2' })).toBe(false);
    expect(hasStoredDraft({ channelId: THREAD.channelId })).toBe(false);
  });

  it('finds a draft of files alone', () => {
    localStorage.setItem(
      makeAttachmentTrackerPersistenceKey(THREAD),
      JSON.stringify([{ id: 'a1', kind: 'image', name: 'a.png' }])
    );

    expect(hasStoredDraft(THREAD)).toBe(true);
  });

  it('does not count blank text', () => {
    localStorage.setItem(
      makeInputValuePersistenceKey(THREAD),
      JSON.stringify('  \n')
    );

    expect(hasStoredDraft(THREAD)).toBe(false);
  });

  it('counts a stored value that is not text as no text', () => {
    localStorage.setItem(makeInputValuePersistenceKey(THREAD), '{}');

    expect(hasStoredDraft(THREAD)).toBe(false);
  });

  it('reads the copy a mounted input holds, and leaves it held', () => {
    createRoot((dispose) => {
      const [text, setText] = holdPersistedDraftText(
        makeInputValuePersistenceKey(THREAD)
      );
      const tracker = createInputAttachmentTracker({
        persistenceKey: makeAttachmentTrackerPersistenceKey(THREAD),
      });
      expect(hasStoredDraft(THREAD)).toBe(false);

      setText('typed just now');
      expect(hasStoredDraft(THREAD)).toBe(true);
      expect(text()).toBe('typed just now');

      setText(undefined);
      tracker.addAttachment({ id: 'a1', kind: 'image', name: 'a.png' });
      expect(hasStoredDraft(THREAD)).toBe(true);
      expect(tracker.attachments()).toHaveLength(1);

      dispose();
    });
  });
});
