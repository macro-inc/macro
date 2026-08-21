/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearTaskComposerDraft,
  loadTaskComposerDraft,
  saveTaskComposerDraft,
  type TaskComposerDraft,
} from './taskComposerStorage';

const DEFAULT_KEY = 'task-composer-draft';

const draft = {
  title: 'A task',
  content: 'body',
  propertyValues: {},
};

function readRaw(key: string): TaskComposerDraft | null {
  const stored = localStorage.getItem(key);
  return stored ? JSON.parse(stored) : null;
}

function writeRaw(key: string, value: TaskComposerDraft) {
  localStorage.setItem(key, JSON.stringify(value));
}

describe('taskComposerStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips a draft under the default key', () => {
    saveTaskComposerDraft(draft);
    expect(loadTaskComposerDraft()?.title).toBe('A task');
    expect(readRaw(DEFAULT_KEY)).toBeTruthy();
  });

  it('scopes drafts to a custom storage key', () => {
    const storage = { storageKey: 'task-composer-draft-channel:c1' };
    saveTaskComposerDraft(draft, storage);

    expect(readRaw(DEFAULT_KEY)).toBeNull();
    expect(loadTaskComposerDraft()).toBeNull();
    expect(loadTaskComposerDraft(storage)?.title).toBe('A task');

    clearTaskComposerDraft(storage);
    expect(loadTaskComposerDraft(storage)).toBeNull();
  });

  it('expires default-key drafts after the expiry window', () => {
    saveTaskComposerDraft(draft);
    const stored = readRaw(DEFAULT_KEY);
    writeRaw(DEFAULT_KEY, {
      ...(stored as TaskComposerDraft),
      timestamp: Date.now() - 10 * 60 * 1000,
    });

    expect(loadTaskComposerDraft()).toBeNull();
    // The expired entry is dropped from storage as a side effect.
    expect(readRaw(DEFAULT_KEY)).toBeNull();
  });

  it('never expires drafts stored with expiryMs null', () => {
    const storage = {
      storageKey: 'task-composer-draft-channel:c1',
      expiryMs: null,
    };
    saveTaskComposerDraft(draft, storage);
    const stored = readRaw(storage.storageKey);
    writeRaw(storage.storageKey, {
      ...(stored as TaskComposerDraft),
      timestamp: Date.now() - 365 * 24 * 60 * 60 * 1000,
    });

    expect(loadTaskComposerDraft(storage)?.title).toBe('A task');
  });

  it('rehydrates DATE property values into Date instances', () => {
    const storage = { storageKey: 'task-composer-draft-channel:c1' };
    saveTaskComposerDraft(
      {
        ...draft,
        propertyValues: {
          due: { valueType: 'DATE', value: new Date('2026-08-04T00:00:00Z') },
        },
      },
      storage
    );

    const loaded = loadTaskComposerDraft(storage);
    const due = loaded?.propertyValues.due as { value: unknown };
    expect(due.value).toBeInstanceOf(Date);
  });
});
