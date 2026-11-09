/**
 * @vitest-environment jsdom
 */

import type {
  SavedTaskTemplate,
  TaskTemplateSelection,
} from '@app/features/task-composer/core/template-selection';
import { freshTaskFromTemplate } from '@app/features/task-composer/core/template-selection';
import {
  areTemplateFieldsDirty,
  isTemplateStateDirty,
  restoreTemplateFields,
} from '@app/features/task-composer/core/template-state';
import type { TaskComposerHost } from '@app/features/task-composer/primitives/task-composer';
import { createTemplateWorkflow } from '@app/features/task-composer/primitives/template-workflow';
import {
  captureTaskTemplate,
  fillTaskTemplate,
  type TaskTemplateContents,
} from '@app/features/task-templates/core/template';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

it('restores the template baseline independently of edited draft values', () => {
  localStorage.clear();
  const baseline = {
    propertyIds: ['priority'],
    propertyDefaults: {
      priority: {
        valueType: 'DATE' as const,
        value: new Date('2026-10-22T00:00:00Z'),
      },
    },
    descriptionMarkdown: 'Preset',
  };
  saveTaskComposerDraft({
    ...draft,
    content: '',
    visiblePropertyIds: [],
    propertyValues: { priority: { valueType: 'DATE', value: null } },
    templateBaseline: baseline,
  });
  const restored = loadTaskComposerDraft();
  if (!restored) throw new Error('Draft was not restored');
  expect(
    isTemplateStateDirty(
      {
        propertyIds: restored.visiblePropertyIds ?? [],
        propertyDefaults: restored.propertyValues,
        descriptionMarkdown: restored.content,
      },
      restored.templateBaseline
    )
  ).toBe(true);
  expect(restored.content).toBe('');
  expect(restored?.visiblePropertyIds).toEqual([]);
  expect(restored?.propertyValues.priority).toEqual({
    valueType: 'DATE',
    value: null,
  });
  expect(restored?.templateBaseline).toEqual(baseline);
  expect(restored?.templateBaseline?.propertyDefaults.priority).toEqual({
    valueType: 'DATE',
    value: new Date('2026-10-22T00:00:00Z'),
  });
  saveTaskComposerDraft(draft);
  const olderDraft = loadTaskComposerDraft();
  expect(olderDraft?.templateBaseline).toBeUndefined();
  if (!olderDraft) throw new Error('Older draft was not restored');
  expect(
    isTemplateStateDirty(
      {
        propertyIds: olderDraft.visiblePropertyIds ?? [],
        propertyDefaults: olderDraft.propertyValues,
        descriptionMarkdown: olderDraft.content,
      },
      olderDraft.templateBaseline
    )
  ).toBe(true);
});

// The injected ports keep workflow tests independent of the app shell and editor UI.
function createTemplateSession() {
  return createRoot((dispose) => {
    const [selection, setSelection] = createSignal<TaskTemplateSelection>({
      kind: 'none',
    });
    const [contents, setContents] = createSignal<TaskTemplateContents>({
      title: 'Keep this task title',
      propertyIds: ['priority'],
      propertyDefaults: { priority: { valueType: 'STRING', value: 'High' } },
      descriptionMarkdown: 'Task-specific prose',
    });
    const [baseline, setBaseline] = createSignal<TaskTemplateContents>(
      contents()
    );
    const [viewer, setViewer] = createSignal<string | undefined>('viewer');
    const [active, setActive] = createSignal(true);
    const create = vi.fn<TaskComposerHost['createTemplate']>(
      async (_viewer, input, values) => ({
        id: input.creationId,
        name: input.name,
        teamId: input.teamId,
        revision: 1,
        contents: values,
      })
    );
    const update = vi.fn<TaskComposerHost['updateTemplate']>(
      async (_viewer, input, values) => ({
        ...input.template,
        revision: input.template.revision + 1,
        contents: values,
      })
    );
    const restore = vi.fn((draft: Omit<TaskComposerDraft, 'timestamp'>) => {
      setSelection(draft.templateSelection ?? { kind: 'none' });
      setContents({
        title: draft.title,
        propertyIds: draft.visiblePropertyIds ?? [],
        propertyDefaults: draft.propertyValues,
        descriptionMarkdown: draft.content,
      });
    });
    const apply = vi.fn((saved: SavedTaskTemplate) => {
      if (workflow.pending()) return;
      setSelection({ kind: 'saved', template: saved });
    });
    const error = vi.fn();
    const workflow = createTemplateWorkflow({
      userId: viewer,
      draftOwner: 'viewer',
      canChange: () => !workflow.pending(),
      sessionActive: active,
      teamId: () => undefined,
      definitions: () => [
        {
          id: 'priority',
          displayName: 'Priority',
          valueType: 'STRING',
          isMultiSelect: false,
          isMetadata: false,
          isSystem: true,
          owner: { scope: 'system' },
          createdAt: new Date(0),
          updatedAt: new Date(0),
        },
      ],
      definitionsReady: () => true,
      baseline,
      setBaseline,
      selection,
      setSelection,
      captureTask: () => ({
        title: 'Keep this task title',
        content: contents().descriptionMarkdown,
        visiblePropertyIds: contents().propertyIds,
        propertyValues: contents().propertyDefaults,
        templateSelection: selection(),
        editorState: {
          root: {
            type: 'root' as const,
            version: 1,
            children: [
              {
                type: 'image',
                version: 1,
                src: 'sfs://draft-image',
                width: 240,
                height: 160,
              },
            ],
            direction: null,
            format: '' as const,
            indent: 0,
          },
        },
      }),
      restoreTask: restore,
      contents,
      replaceContents: setContents,
      stripAttachments: () => {},
      applyTemplate: apply,
      persist: () => saveTaskComposerDraft(workflow.snapshot()),
      setError: error,
      createTemplate: create,
      updateTemplate: update,
    });
    return {
      dispose,
      workflow,
      contents,
      setContents,
      selection,
      setSelection,
      baseline,
      setViewer,
      setActive,
      create,
      update,
      restore,
      apply,
      error,
    };
  });
}

it('keeps the task draft underneath template edits and restores it on cancel', () => {
  const session = createTemplateSession();
  const original = session.workflow.snapshot();
  session.workflow.open(
    {
      kind: 'new',
      name: 'Reusable',
      teamId: null,
      creationId: '0195dbd0-7b5d-7000-8000-000000000002',
    },
    session.contents()
  );
  session.setContents({
    propertyIds: [],
    propertyDefaults: {},
    descriptionMarkdown: 'Template-only edits',
  });
  const snapshot = session.workflow.snapshot();
  expect(snapshot.title).toBe(original.title);
  expect(snapshot.content).toBe(original.content);
  expect(snapshot.propertyValues).toEqual(original.propertyValues);
  expect(snapshot.editorState).toEqual(original.editorState);
  expect(snapshot.templateEditor?.contents.descriptionMarkdown).toBe(
    'Template-only edits'
  );
  saveTaskComposerDraft(snapshot);
  expect(
    loadTaskComposerDraft()?.templateEditor?.contents.descriptionMarkdown
  ).toBe('Template-only edits');
  session.workflow.cancelTemplateEdit();
  expect(session.workflow.snapshot()).toEqual(original);
  expect(session.create).not.toHaveBeenCalled();
  session.dispose();
});

it('saves only the template and restores the task before applying the saved selection', async () => {
  const session = createTemplateSession();
  const original = session.workflow.snapshot();
  session.workflow.open(
    {
      kind: 'new',
      name: 'Reusable',
      teamId: null,
      creationId: '0195dbd0-7b5d-7000-8000-000000000002',
    },
    session.contents()
  );
  await session.workflow.saveTemplate();
  expect(session.create).toHaveBeenCalledTimes(1);
  expect(session.create.mock.calls[0][1].name).toBe('Reusable');
  expect(session.create.mock.calls[0][2].title).toBe('Keep this task title');
  expect(session.restore).toHaveBeenCalledWith(original);
  expect(session.apply).toHaveBeenCalledWith(
    expect.objectContaining({ id: '0195dbd0-7b5d-7000-8000-000000000002' }),
    true
  );
  expect(session.workflow.isTemplateMode()).toBe(false);
  expect(session.selection().kind).toBe('saved');
  expect(session.workflow.pending()).toBe(false);
  session.dispose();
});

it('restores and reuses the admitted creation identity after a lost response', async () => {
  localStorage.clear();
  const session = createTemplateSession();
  session.workflow.open(
    {
      kind: 'new',
      name: 'Reusable',
      teamId: null,
      creationId: '0195dbd0-7b5d-7000-8000-000000000002',
    },
    session.contents()
  );
  session.create.mockRejectedValueOnce(new Error('Response lost'));
  await session.workflow.saveTemplate();
  const stored = loadTaskComposerDraft();
  expect(stored?.templateEditor?.request?.creationId).toBe(
    '0195dbd0-7b5d-7000-8000-000000000002'
  );
  expect(stored?.templateEditor?.request?.contents.title).toBe(
    'Keep this task title'
  );
  session.dispose();
  const restored = createTemplateSession();
  if (!stored?.templateEditor)
    throw new Error('Template editing session was not stored');
  restored.workflow.resume(stored.templateEditor);
  await restored.workflow.saveTemplate();
  expect(restored.create.mock.calls[0][1].creationId).toBe(
    '0195dbd0-7b5d-7000-8000-000000000002'
  );
  restored.dispose();
});

it('updates field defaults without copying task-specific title or description', async () => {
  const session = createTemplateSession();
  session.setSelection({
    kind: 'saved',
    template: {
      id: 'saved',
      name: 'Reusable',
      teamId: null,
      revision: 2,
      contents: {
        ...session.contents(),
        title: 'Saved title',
        descriptionMarkdown: 'Saved description',
      },
    },
  });
  session.setContents({
    ...session.contents(),
    title: 'Task-specific title',
    propertyDefaults: { priority: { valueType: 'STRING', value: 'Low' } },
  });
  await session.workflow.updateTemplateFields();
  expect(session.update.mock.calls[0][2].title).toBe('Saved title');
  expect(session.update.mock.calls[0][2].descriptionMarkdown).toBe(
    'Saved description'
  );
  expect(session.update.mock.calls[0][2].propertyDefaults.priority).toEqual({
    valueType: 'STRING',
    value: 'Low',
  });
  expect(session.contents().descriptionMarkdown).toBe('Task-specific prose');
  expect(session.contents().title).toBe('Task-specific title');
  expect(session.baseline().title).toBe('Keep this task title');
  expect(session.baseline().descriptionMarkdown).toBe('Task-specific prose');
  session.dispose();
});

it('does not restore a template save after the acting account changes', async () => {
  const session = createTemplateSession();
  const pending = Promise.withResolvers<SavedTaskTemplate>();
  session.create.mockReturnValueOnce(pending.promise);
  session.workflow.open(
    {
      kind: 'new',
      name: 'Reusable',
      teamId: null,
      creationId: '0195dbd0-7b5d-7000-8000-000000000002',
    },
    session.contents()
  );
  const saving = session.workflow.saveTemplate();
  session.setViewer('another-viewer');
  pending.resolve({
    id: 'saved',
    name: 'Reusable',
    revision: 1,
    teamId: null,
    contents: session.contents(),
  });
  await saving;
  expect(session.restore).not.toHaveBeenCalled();
  expect(session.apply).not.toHaveBeenCalled();
  session.dispose();
});

it('marks only changed fields, not task description edits or equivalent blank values', () => {
  const baseline: TaskTemplateContents = {
    propertyIds: ['flag', 'empty'],
    title: 'Saved title',
    propertyDefaults: { flag: { valueType: 'BOOLEAN', value: false } },
    descriptionMarkdown: 'Saved description',
  };
  expect(
    areTemplateFieldsDirty(
      {
        ...baseline,
        title: 'Task-specific title',
        descriptionMarkdown: 'Task prose',
        propertyDefaults: {
          ...baseline.propertyDefaults,
          empty: { valueType: 'STRING', value: '' },
        },
      },
      baseline
    )
  ).toBe(false);
  expect(
    areTemplateFieldsDirty(
      {
        ...baseline,
        propertyDefaults: { flag: { valueType: 'BOOLEAN', value: true } },
      },
      baseline
    )
  ).toBe(true);
});

it('ignores late saves after logout clears storage before the account signal changes', async () => {
  localStorage.clear();
  const session = createTemplateSession();
  const pending = Promise.withResolvers<SavedTaskTemplate>();
  session.create.mockReturnValueOnce(pending.promise);
  session.workflow.open(
    {
      kind: 'new',
      name: 'Reusable',
      teamId: null,
      creationId: '0195dbd0-7b5d-7000-8000-000000000002',
    },
    session.contents()
  );
  const saving = session.workflow.saveTemplate();
  session.setActive(false);
  localStorage.clear();
  pending.resolve({
    id: 'saved',
    name: 'Reusable',
    revision: 1,
    teamId: null,
    contents: session.contents(),
  });
  await saving;
  expect(session.restore).not.toHaveBeenCalled();
  expect(session.apply).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(0);
  session.dispose();
});

it('resets edited defaults while retaining a Source field added after template application', () => {
  const baseline: TaskTemplateContents = {
    propertyIds: ['priority'],
    propertyDefaults: { priority: { valueType: 'STRING', value: 'High' } },
    descriptionMarkdown: 'Saved description',
  };
  const current: TaskTemplateContents = {
    propertyIds: ['priority', SYSTEM_PROPERTY_IDS.SOURCE],
    propertyDefaults: {
      priority: { valueType: 'STRING', value: 'Low' },
      [SYSTEM_PROPERTY_IDS.SOURCE]: {
        valueType: 'ENTITY',
        refs: [
          {
            entity_type: 'CHANNEL',
            entity_id: 'channel',
            specific_message_id: '0195dbd0-7b5d-7000-8000-000000000003',
          },
        ],
      },
    },
    descriptionMarkdown: 'Task-specific prose',
  };
  const reset = restoreTemplateFields(current, baseline);
  expect(reset.propertyIds).toContain(SYSTEM_PROPERTY_IDS.SOURCE);
  expect(reset.propertyDefaults[SYSTEM_PROPERTY_IDS.SOURCE]).toEqual(
    current.propertyDefaults[SYSTEM_PROPERTY_IDS.SOURCE]
  );
  expect(reset.propertyDefaults.priority).toEqual(
    baseline.propertyDefaults.priority
  );
  expect(reset.descriptionMarkdown).toBe('Task-specific prose');
  expect(areTemplateFieldsDirty(reset, baseline)).toBe(false);
});

it('captures the draft task title and applies saved text to fresh repeated tasks', () => {
  const initial: TaskTemplateContents = {
    title: '',
    propertyIds: [],
    propertyDefaults: {},
    descriptionMarkdown: '',
  };
  const captured = captureTaskTemplate(
    {
      ...initial,
      title: 'Review request',
      descriptionMarkdown: 'Review steps',
    },
    new Set(),
    new Set()
  );
  const fresh = freshTaskFromTemplate(initial, captured, new Set(), new Set());
  expect(fresh.title).toBe('Review request');
  expect(fresh.descriptionMarkdown).toBe('Review steps');
  expect(
    fillTaskTemplate(
      {
        ...initial,
        title: 'Existing task',
        descriptionMarkdown: 'Existing prose',
      },
      captured,
      new Set()
    )
  ).toMatchObject({
    title: 'Existing task',
    descriptionMarkdown: 'Existing prose',
  });
});

it('persists default titles in selected templates and the separate editing buffer', () => {
  const contents: TaskTemplateContents = {
    title: 'Default task title',
    propertyIds: [],
    propertyDefaults: {},
    descriptionMarkdown: '',
  };
  saveTaskComposerDraft({
    ...draft,
    templateSelection: {
      kind: 'saved',
      template: {
        id: 'saved',
        name: 'Reusable',
        teamId: null,
        revision: 1,
        contents,
      },
    },
    templateBaseline: contents,
    templateEditor: {
      selection: {
        kind: 'new',
        name: 'Another name',
        teamId: null,
        creationId: '0195dbd0-7b5d-7000-8000-000000000002',
      },
      contents,
    },
  });
  const restored = loadTaskComposerDraft();
  expect(restored?.templateBaseline?.title).toBe('Default task title');
  expect(restored?.templateEditor?.contents.title).toBe('Default task title');
  expect(restored?.templateSelection).toMatchObject({
    kind: 'saved',
    template: { name: 'Reusable', contents: { title: 'Default task title' } },
  });
});

it('confirms title replacement without marking field-only edits and treats omitted titles as empty', () => {
  const baseline: TaskTemplateContents = {
    propertyIds: [],
    propertyDefaults: {},
    descriptionMarkdown: '',
  };
  expect(isTemplateStateDirty({ ...baseline, title: '' }, baseline)).toBe(
    false
  );
  const changed = { ...baseline, title: 'Current task title' };
  expect(isTemplateStateDirty(changed, baseline)).toBe(true);
  expect(areTemplateFieldsDirty(changed, baseline)).toBe(false);
  expect(restoreTemplateFields(changed, baseline).title).toBe(
    'Current task title'
  );
});

it('restores draft sharing without letting template edits change the global default', () => {
  localStorage.setItem('task-composer-share-with-team', 'true');
  saveTaskComposerDraft({ ...draft, shareWithTeam: false });
  const restored = loadTaskComposerDraft();
  expect(restored?.shareWithTeam).toBe(false);
  createRoot((dispose) => {
    const [editing, setEditing] = createSignal(false);
    const [sharing, setSharing] = createTaskComposerSharing(undefined, {
      initialValue: restored?.shareWithTeam,
      canPersist: () => !editing(),
    });
    expect(sharing()).toBe(false);
    setEditing(true);
    setSharing(true);
    setSharing(false);
    expect(localStorage.getItem('task-composer-share-with-team')).toBe('true');
    setEditing(false);
    setSharing(false);
    expect(localStorage.getItem('task-composer-share-with-team')).toBe('false');
    dispose();
  });
});
