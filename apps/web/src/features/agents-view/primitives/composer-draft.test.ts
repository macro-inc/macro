/**
 * @vitest-environment jsdom
 */

import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createPersistedComposerDraft,
  NEW_CONVERSATION_DRAFT_KEY,
} from './composer-draft';

describe('createPersistedComposerDraft', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('rehydrates the persisted draft for the same key', () => {
    createRoot((dispose) => {
      const draft = createPersistedComposerDraft();
      draft.setDraft('keep this prompt');
      expect(draft.draft()).toBe('keep this prompt');
      dispose();
    });

    createRoot((dispose) => {
      const draft = createPersistedComposerDraft();
      expect(draft.draft()).toBe('keep this prompt');
      dispose();
    });
  });

  it('removes the persisted value when the draft becomes empty', () => {
    createRoot((dispose) => {
      const draft = createPersistedComposerDraft();
      draft.setDraft('keep this prompt');
      draft.setDraft('');
      dispose();
    });

    expect(localStorage.getItem(NEW_CONVERSATION_DRAFT_KEY)).toBeNull();

    createRoot((dispose) => {
      const draft = createPersistedComposerDraft();
      expect(draft.draft()).toBe('');
      dispose();
    });
  });
});
