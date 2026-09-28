/**
 * @vitest-environment jsdom
 */

import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createPersistedComposerDraft,
  HOME_CONVERSATION_DRAFT_KEY,
  NEW_CONVERSATION_DRAFT_KEY,
} from './composer-draft';

describe('createPersistedComposerDraft', () => {
  it('keeps Home and Agents drafts independent when either is cleared', () => {
    createRoot((dispose) => {
      const home = createPersistedComposerDraft(HOME_CONVERSATION_DRAFT_KEY);
      const agents = createPersistedComposerDraft();
      home.setDraft('Home prompt');
      agents.setDraft('Agents prompt');
      dispose();
    });
    createRoot((dispose) => {
      const home = createPersistedComposerDraft(HOME_CONVERSATION_DRAFT_KEY);
      const agents = createPersistedComposerDraft();
      expect(home.draft()).toBe('Home prompt');
      expect(agents.draft()).toBe('Agents prompt');
      home.setDraft('');
      expect(agents.draft()).toBe('Agents prompt');
      dispose();
    });
    expect(localStorage.getItem(HOME_CONVERSATION_DRAFT_KEY)).toBeNull();
  });
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
