/**
 * @vitest-environment jsdom
 */

import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearTaskComposerDraft,
  createTaskComposerSharing,
  loadTaskComposerDraft,
  saveTaskComposerDraft,
  type TaskComposerDraft,
  taskComposerContextStorage,
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

describe('context drafts', () => {
  beforeEach(() => localStorage.clear());

  it('isolates context keys and persists visible property ids without touching the global draft', () => {
    const company = taskComposerContextStorage('crm:company:one');
    const contact = taskComposerContextStorage('crm:contact:two');
    saveTaskComposerDraft(
      { ...draft, visiblePropertyIds: ['company'] },
      company
    );
    saveTaskComposerDraft(
      { ...draft, title: 'Contact', visiblePropertyIds: [] },
      contact
    );
    saveTaskComposerDraft(draft);

    expect(company.storageKey).toBe('task-composer-draft:crm:company:one');
    expect(loadTaskComposerDraft(company)?.visiblePropertyIds).toEqual([
      'company',
    ]);
    expect(loadTaskComposerDraft(contact)?.visiblePropertyIds).toEqual([]);
    clearTaskComposerDraft(company);
    expect(loadTaskComposerDraft(contact)?.title).toBe('Contact');
    expect(loadTaskComposerDraft()?.title).toBe('A task');
  });
});

it('keeps recovered sharing local while new composers remember the default', () => {
  localStorage.setItem('task-composer-share-with-team', 'true');
  createRoot((dispose) => {
    const [recovered, setRecovered] = createTaskComposerSharing(false);
    expect(recovered()).toBe(false);
    expect(localStorage.getItem('task-composer-share-with-team')).toBe('true');
    setRecovered(true);
    setRecovered(false);
    expect(localStorage.getItem('task-composer-share-with-team')).toBe('true');
    const [fresh, setFresh] = createTaskComposerSharing();
    expect(fresh()).toBe(true);
    setFresh(false);
    expect(createTaskComposerSharing()[0]()).toBe(false);
    dispose();
  });
});

it('preserves specific message references through draft recovery', () => {
  const reference = {
    entity_id: 'channel',
    entity_type: 'CHANNEL' as const,
    specific_message_id: '0195dbd0-7b5d-7000-8000-000000000001',
  };
  saveTaskComposerDraft({
    ...draft,
    propertyValues: { source: { valueType: 'ENTITY', refs: [reference] } },
  });
  expect(loadTaskComposerDraft()?.propertyValues.source).toEqual({
    valueType: 'ENTITY',
    refs: [reference],
  });
});

it('restores template mode and scope with the edited draft', () => {
  localStorage.clear();
  saveTaskComposerDraft({
    ...draft,
    templateSelection: {
      kind: 'new',
      name: 'Reusable',
      teamId: 'team-1',
      creationId: '0195dbd0-7b5d-7000-8000-000000000001',
    },
  });
  expect(loadTaskComposerDraft()?.templateSelection).toEqual({
    kind: 'new',
    name: 'Reusable',
    teamId: 'team-1',
    creationId: '0195dbd0-7b5d-7000-8000-000000000001',
  });
});

it('restores the captured revision and edited name', () => {
  localStorage.clear();
  const template = {
    id: 'saved',
    revision: 3,
    name: 'Before',
    teamId: null,
    contents: {
      propertyIds: [],
      propertyDefaults: {},
      descriptionMarkdown: 'Original',
    },
  };
  saveTaskComposerDraft({
    ...draft,
    templateSelection: { kind: 'editing', template, name: 'After' },
  });
  expect(loadTaskComposerDraft()?.templateSelection).toEqual({
    kind: 'editing',
    template,
    name: 'After',
  });
});

it('retains the admitted template request beside later composer edits', () => {
  const request = {
    creationId: '0195dbd0-7b5d-7000-8000-000000000001',
    name: 'First',
    teamId: null,
    contents: {
      propertyIds: ['due'],
      propertyDefaults: {
        due: {
          valueType: 'DATE' as const,
          value: new Date('2025-10-22T00:00:00Z'),
        },
      },
      descriptionMarkdown: 'First',
    },
  };
  const storage = taskComposerContextStorage('pending-template');
  saveTaskComposerDraft(
    { ...draft, templateRequest: request, content: 'Edited' },
    storage
  );
  expect(loadTaskComposerDraft(storage)?.templateRequest).toEqual(request);
  expect(loadTaskComposerDraft(storage)?.content).toBe('Edited');
});
