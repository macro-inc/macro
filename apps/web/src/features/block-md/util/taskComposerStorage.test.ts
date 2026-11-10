/**
 * @vitest-environment jsdom
 */

import type {
  SavedTaskTemplate,
  TaskTemplateEditorDraft,
  TaskTemplateSelection,
} from '@app/features/task-composer/core/template-selection';
import { freshTaskFromTemplate } from '@app/features/task-composer/core/template-selection';
import {
  areTemplateFieldsDirty,
  isTemplateStateDirty,
  restoreTemplateFields,
  taskTemplateSharing,
} from '@app/features/task-composer/core/template-state';
import type { ComposeTaskProps } from '@app/features/task-composer/core/types';
import {
  createTaskComposer,
  type TaskComposerHost,
} from '@app/features/task-composer/primitives/task-composer';
import { createTemplateWorkflow } from '@app/features/task-composer/primitives/template-workflow';
import {
  captureTaskTemplate,
  fillTaskTemplate,
  type TaskTemplateContents,
} from '@app/features/task-templates/core/template';
import {
  isConfirmedTemplateUpdate,
  taskTemplateConfiguration,
  taskTemplateContents,
} from '@app/features/task-templates/queries/template-mapping';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import type { TaskTemplateConfiguration } from '@service-storage/generated/schemas/taskTemplateConfiguration';
import { QueryClient } from '@tanstack/solid-query';
import { createRoot, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearTaskComposerDraft,
  createTaskComposerSharing,
  loadTaskComposerDraft,
  saveTaskComposerDraft,
  type TaskComposerDraft,
  taskComposerContextStorage,
} from './taskComposerStorage';

// Only external composer ports are replaced; template and sharing behavior stays real.
vi.mock('@tanstack/solid-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/solid-query')>()),
  useQueryClient: () => new QueryClient(),
}));
vi.mock('@queries/team/teams', () => ({
  useUserTeamsQuery: () => ({
    isPending: false,
    isSuccess: true,
    data: [{ id: 'team' }],
  }),
}));
vi.mock('@queries/history/history', () => ({
  useUpsertToHistoryMutation: () => ({ mutate: vi.fn() }),
}));
vi.mock('@core/hotkey/hotkeys', () => ({
  useHotkeyDOMScope: () => [vi.fn(), 'test-composer'],
  registerHotkey: vi.fn(),
}));
vi.mock('@block-md/util/taskComposerProperties', async () => {
  const { createStore } = await import('solid-js/store');
  const { createSignal } = await import('solid-js');
  return {
    DEFAULT_TASK_COMPOSER_PROPERTY_IDS: [],
    defaultTaskPropertyValues: () => ({}),
    createTaskComposerProperties: (options: {
      initialValues: Record<string, unknown>;
    }) => {
      const [propertyValues, setPropertyValues] = createStore(
        options.initialValues
      );
      const [selectedPropertyIds, setVisiblePropertyIds] = createSignal<
        string[]
      >([]);
      return {
        propertyValues,
        setPropertyValues,
        selectedPropertyIds,
        setVisiblePropertyIds,
        writableProperties: () => [],
        definitionsReady: () => true,
        createDefinitions: () => new Map(),
        properties: [],
        availableProperties: [],
        addProperty: vi.fn(),
        saveHandler: vi.fn(),
        clearComposerTags: vi.fn(),
        composerTags: { appliedTags: () => [], isApplied: () => false },
      };
    },
  };
});
vi.mock(
  '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder',
  () => ({
    buildConfig: () => {
      const config = new Proxy(
        {},
        {
          get: (_target, key) =>
            key === 'buildHandle'
              ? () => ({ lexical: undefined })
              : () => config,
        }
      );
      return config;
    },
  })
);
vi.mock('@core/component/LexicalMarkdown/plugins/media', () => ({
  addMediaFromFile: vi.fn(),
}));
vi.mock('@core/component/LexicalMarkdown/utils', () => ({
  initializeEditorEmpty: vi.fn(),
  initializeEditorWithState: vi.fn(),
}));
vi.mock('@app/features/task-composer/primitives/template-editor', () => ({
  applyTemplateToEditor: (template: TaskTemplateContents) => template,
  removeTemplateAttachments: () => undefined,
}));

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
function createTemplateSession(
  initialEditor?: TaskTemplateEditorDraft,
  initialEnabled = true
) {
  return createRoot((dispose) => {
    const [selection, setSelection] = createSignal<TaskTemplateSelection>({
      kind: 'none',
    });
    const [contents, setContents] = createSignal<TaskTemplateContents>({
      title: 'Keep this task title',
      shareWithTeam: true,
      propertyIds: ['priority'],
      propertyDefaults: { priority: { valueType: 'STRING', value: 'High' } },
      descriptionMarkdown: 'Task-specific prose',
    });
    const [baseline, setBaseline] = createSignal<TaskTemplateContents>(
      contents()
    );
    const [viewer, setViewer] = createSignal<string | undefined>('viewer');
    const [active, setActive] = createSignal(true);
    const [enabled, setEnabled] = createSignal(initialEnabled);
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
        shareWithTeam: draft.shareWithTeam,
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
      enabled,
      initialEditor,
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
        shareWithTeam: contents().shareWithTeam,
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
      setEnabled,
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
    shareWithTeam: false,
    propertyDefaults: {},
    descriptionMarkdown: 'Template-only edits',
  });
  const snapshot = session.workflow.snapshot();
  expect(snapshot.title).toBe(original.title);
  expect(snapshot.content).toBe(original.content);
  expect(snapshot.propertyValues).toEqual(original.propertyValues);
  expect(snapshot.shareWithTeam).toBe(true);
  expect(snapshot.templateEditor?.contents.shareWithTeam).toBe(false);
  expect(snapshot.editorState).toEqual(original.editorState);
  expect(snapshot.templateEditor?.contents.descriptionMarkdown).toBe(
    'Template-only edits'
  );
  saveTaskComposerDraft(snapshot);
  expect(loadTaskComposerDraft()?.shareWithTeam).toBe(true);
  expect(loadTaskComposerDraft()?.templateEditor?.contents.shareWithTeam).toBe(
    false
  );
  expect(
    loadTaskComposerDraft()?.templateEditor?.contents.descriptionMarkdown
  ).toBe('Template-only edits');
  session.workflow.cancelTemplateEdit();
  expect(session.contents().shareWithTeam).toBe(true);
  expect(session.workflow.snapshot()).toEqual(original);
  expect(session.create).not.toHaveBeenCalled();
  session.dispose();
});

it('keeps a stored editor separate from the task while disabled', async () => {
  const stored: TaskTemplateEditorDraft = {
    selection: {
      kind: 'new',
      name: 'Reusable',
      teamId: null,
      creationId: '0195dbd0-7b5d-7000-8000-000000000002',
    },
    contents: {
      title: 'Template title',
      propertyIds: [],
      propertyDefaults: {},
      descriptionMarkdown: 'Template prose',
    },
  };
  const session = createTemplateSession(stored, false);
  const original = session.workflow.snapshot();
  session.workflow.open(stored.selection, stored.contents);
  session.workflow.resume();
  await session.workflow.saveTemplate();
  expect(session.workflow.isTemplateMode()).toBe(false);
  expect(session.create).not.toHaveBeenCalled();
  expect(session.workflow.snapshot()).toMatchObject({
    title: original.title,
    content: original.content,
    editorState: original.editorState,
    templateEditor: stored,
  });
  session.workflow.discardSuspendedEditor();
  expect(session.workflow.snapshot().templateEditor).toBeUndefined();
  expect(session.workflow.snapshot().content).toBe(original.content);
  session.dispose();
});

it('recovers a suspended editor without changing the underlying task', async () => {
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
  session.create.mockRejectedValueOnce(new Error('Response lost'));
  await session.workflow.saveTemplate();
  session.setContents({
    ...session.contents(),
    descriptionMarkdown: 'Template-only prose',
  });
  session.setEnabled(false);
  await session.workflow.saveTemplate();
  expect(session.create).toHaveBeenCalledTimes(1);
  session.workflow.suspend();
  expect(session.workflow.isTemplateMode()).toBe(false);
  expect(session.restore).toHaveBeenCalledWith(original);
  expect(session.contents().descriptionMarkdown).toBe(original.content);
  const snapshot = session.workflow.snapshot();
  expect(snapshot.title).toBe(original.title);
  expect(snapshot.content).toBe(original.content);
  expect(snapshot.editorState).toEqual(original.editorState);
  expect(snapshot.templateEditor?.contents.descriptionMarkdown).toBe(
    'Template-only prose'
  );
  expect(snapshot.templateEditor?.request?.creationId).toBe(
    '0195dbd0-7b5d-7000-8000-000000000002'
  );
  session.workflow.resume();
  expect(session.workflow.isTemplateMode()).toBe(false);
  session.setEnabled(true);
  session.workflow.resume();
  expect(session.contents().descriptionMarkdown).toBe('Template-only prose');
  expect(session.workflow.snapshot().templateEditor?.request).toEqual(
    snapshot.templateEditor?.request
  );
  session.dispose();
});

it('ignores a save that completes after the workflow is disabled', async () => {
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
  session.setEnabled(false);
  session.workflow.suspend();
  expect(session.workflow.pending()).toBe(true);
  pending.resolve({
    id: 'saved',
    name: 'Reusable',
    revision: 1,
    teamId: null,
    contents: session.contents(),
  });
  await saving;
  expect(session.restore).toHaveBeenCalledTimes(1);
  expect(session.apply).not.toHaveBeenCalled();
  expect(session.workflow.pending()).toBe(false);
  expect(session.workflow.snapshot().templateEditor?.request?.creationId).toBe(
    '0195dbd0-7b5d-7000-8000-000000000002'
  );
  session.setEnabled(true);
  session.workflow.resume();
  await session.workflow.saveTemplate();
  expect(session.create).toHaveBeenCalledTimes(2);
  expect(session.create.mock.calls[1][1].creationId).toBe(
    '0195dbd0-7b5d-7000-8000-000000000002'
  );
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
  expect(session.create.mock.calls[0][2].shareWithTeam).toBe(true);
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
    shareWithTeam: false,
    propertyDefaults: { priority: { valueType: 'STRING', value: 'Low' } },
  });
  await session.workflow.updateTemplateFields();
  expect(session.update.mock.calls[0][2].title).toBe('Saved title');
  expect(session.update.mock.calls[0][2].shareWithTeam).toBe(false);
  expect(session.baseline().shareWithTeam).toBe(false);
  expect(areTemplateFieldsDirty(session.contents(), session.baseline())).toBe(
    false
  );
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

it.each([false, true])(
  'ignores a disabled field update when re-enabled is %s',
  async (reenabled) => {
    const session = createTemplateSession();
    const saved: SavedTaskTemplate = {
      id: 'saved',
      name: 'Reusable',
      revision: 2,
      teamId: null,
      contents: session.contents(),
    };
    session.setSelection({ kind: 'saved', template: saved });
    session.setEnabled(false);
    await session.workflow.updateTemplateFields();
    expect(session.update).not.toHaveBeenCalled();
    session.setEnabled(true);
    const pending = Promise.withResolvers<SavedTaskTemplate>();
    session.update.mockReturnValueOnce(pending.promise);
    const updating = session.workflow.updateTemplateFields();
    session.setEnabled(false);
    session.workflow.suspend();
    session.setEnabled(reenabled);
    pending.resolve({ ...saved, revision: 3 });
    await updating;
    expect(session.selection()).toEqual({ kind: 'saved', template: saved });
    expect(session.baseline()).toEqual(session.contents());
    session.dispose();
  }
);

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

it.each([true, false, undefined])(
  'preserves saved sharing %s when no team can expose the switch',
  (sharing) => {
    const template: SavedTaskTemplate = {
      id: 'saved',
      name: 'Reusable',
      teamId: null,
      revision: 1,
      contents: {
        shareWithTeam: sharing,
        propertyIds: [],
        propertyDefaults: {},
        descriptionMarkdown: '',
      },
    };
    expect(taskTemplateSharing(true, { kind: 'saved', template }, false)).toBe(
      sharing
    );
    expect(
      taskTemplateSharing(
        true,
        { kind: 'editing', template, name: template.name },
        false
      )
    ).toBe(sharing);
    expect(
      taskTemplateSharing(
        false,
        { kind: 'editing', template, name: template.name },
        true
      )
    ).toBe(false);
  }
);

it.each([true, false])(
  'captures and applies template task sharing %s independently of template ownership',
  (sharing) => {
    const initial: TaskTemplateContents = {
      shareWithTeam: !sharing,
      propertyIds: [],
      propertyDefaults: {},
      descriptionMarkdown: '',
    };
    const captured = captureTaskTemplate(
      { ...initial, shareWithTeam: sharing },
      new Set()
    );
    expect(captured.shareWithTeam).toBe(sharing);
    expect(fillTaskTemplate(initial, captured, new Set()).shareWithTeam).toBe(
      sharing
    );
    const next = freshTaskFromTemplate(initial, captured, new Set(), new Set());
    expect(next.shareWithTeam).toBe(sharing);
    expect(
      freshTaskFromTemplate(next, captured, new Set(), new Set()).shareWithTeam
    ).toBe(sharing);
  }
);

it.each([true, false])(
  'keeps the current sharing %s when a template omits sharing',
  (sharing) => {
    const initial: TaskTemplateContents = {
      shareWithTeam: sharing,
      propertyIds: [],
      propertyDefaults: {},
      descriptionMarkdown: '',
    };
    const template = {
      propertyIds: [],
      propertyDefaults: {},
      descriptionMarkdown: '',
    };
    expect(fillTaskTemplate(initial, template, new Set()).shareWithTeam).toBe(
      sharing
    );
    expect(
      freshTaskFromTemplate(initial, template, new Set(), new Set())
        .shareWithTeam
    ).toBe(sharing);
  }
);

it.each([true, false])(
  'marks and resets sharing %s as a template field without changing task text',
  (sharing) => {
    const baseline: TaskTemplateContents = {
      title: 'Saved title',
      shareWithTeam: sharing,
      propertyIds: [],
      propertyDefaults: {},
      descriptionMarkdown: 'Saved prose',
    };
    const changed = {
      ...baseline,
      shareWithTeam: !sharing,
      title: 'Task title',
      descriptionMarkdown: 'Task prose',
    };
    expect(areTemplateFieldsDirty(changed, baseline)).toBe(true);
    const reset = restoreTemplateFields(changed, baseline);
    expect(reset.shareWithTeam).toBe(sharing);
    expect(reset.title).toBe('Task title');
    expect(reset.descriptionMarkdown).toBe('Task prose');
    expect(areTemplateFieldsDirty(reset, baseline)).toBe(false);
  }
);

it.each([true, false, undefined])(
  'round-trips optional sharing %s through template API mapping',
  (sharing) => {
    const contents: TaskTemplateContents = {
      shareWithTeam: sharing,
      propertyIds: [],
      propertyDefaults: {},
      descriptionMarkdown: '',
    };
    const configuration = taskTemplateConfiguration(contents, []);
    const wire = JSON.parse(JSON.stringify(configuration));
    expect(wire.shareWithTeam).toBe(sharing);
    expect(taskTemplateContents(wire, []).shareWithTeam).toBe(sharing);
    const original: SavedTaskTemplate = {
      id: 'saved',
      name: 'Reusable',
      teamId: null,
      revision: 1,
      contents,
    };
    const observed = {
      id: original.id,
      name: original.name,
      userId: 'viewer',
      creatorId: 'viewer',
      revision: 2,
      configuration,
      canManage: true,
      createdAt: '',
      updatedAt: '',
    };
    expect(
      isConfirmedTemplateUpdate(
        observed,
        original,
        'viewer',
        'Reusable',
        configuration
      )
    ).toBe(true);
    expect(
      isConfirmedTemplateUpdate(
        {
          ...observed,
          configuration: {
            ...configuration,
            shareWithTeam: sharing === undefined ? false : !sharing,
          },
        },
        original,
        'viewer',
        'Reusable',
        configuration
      )
    ).toBe(false);
  }
);

it('opens a personal template with entity defaults from the reactive query cache', () => {
  const [configuration] = createStore<TaskTemplateConfiguration>({
    propertyIds: ['assignee'],
    defaults: [
      {
        propertyId: 'assignee',
        value: {
          type: 'entity_reference',
          reference: { entity_type: 'USER', entity_id: 'template-assignee' },
        },
      },
    ],
    descriptionMarkdown: 'Saved description',
  });
  const saved: SavedTaskTemplate = {
    id: 'personal-template',
    name: 'Personal checklist',
    teamId: null,
    revision: 1,
    contents: taskTemplateContents(configuration, [
      {
        id: 'assignee',
        displayName: 'Assignee',
        valueType: 'ENTITY',
        isMultiSelect: false,
        isMetadata: false,
        isSystem: true,
        owner: { scope: 'system' },
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    ]),
  };
  const session = createTemplateSession();
  try {
    session.workflow.open(
      { kind: 'editing', template: saved, name: saved.name },
      saved.contents
    );
    expect(session.selection().kind).toBe('editing');
    expect(session.contents().propertyDefaults.assignee).toEqual({
      valueType: 'ENTITY',
      refs: [{ entity_type: 'USER', entity_id: 'template-assignee' }],
    });
    session.workflow.cancelTemplateEdit();
    expect(session.contents().title).toBe('Keep this task title');
  } finally {
    session.dispose();
  }
});

describe('repeated task sharing', () => {
  it.each([true, false, undefined])(
    'reapplies saved sharing %s after task-specific overrides',
    async (defaultSharing) => {
      localStorage.clear();
      const createTask = vi.fn<NonNullable<ComposeTaskProps['createTask']>>(
        async (
          _title,
          _content,
          _properties,
          _definitions,
          _upsert,
          options
        ) => {
          options?.onMutate?.();
          const created = {
            documentId: crypto.randomUUID(),
            initialSnapshot: new Uint8Array(),
          };
          options?.onCreated?.(created);
          return created;
        }
      );
      const host: TaskComposerHost = {
        userId: () => 'viewer',
        templatesEnabled: () => true,
        resolveAppLink: undefined,
        createTemplate: vi.fn(),
        updateTemplate: vi.fn(),
        isPopover: () => false,
        fillSheet: vi.fn(),
        setDisplayName: vi.fn(),
        close: vi.fn(),
        openComposer: vi.fn(),
        openTask: vi.fn(),
        openPendingTask: () => ({ show: vi.fn(), cancel: vi.fn() }),
      };
      const dispose = createRoot((dispose) => {
        const composer = createTaskComposer(
          { createTask, onSuccess: vi.fn() },
          host
        );
        return { composer, dispose };
      });
      const { composer } = dispose;
      try {
        const initialChoice =
          defaultSharing === undefined ? false : !defaultSharing;
        composer.setShareWithTeam(initialChoice);
        composer.selectTemplate({
          id: 'saved',
          name: 'Reusable',
          teamId: null,
          revision: 1,
          contents: {
            title: 'Repeated task',
            shareWithTeam: defaultSharing,
            propertyIds: [],
            propertyDefaults: {},
            descriptionMarkdown: '',
          },
        });
        const expected = defaultSharing ?? initialChoice;
        expect(composer.shareWithTeam()).toBe(expected);
        composer.setCreateMore(true);
        for (let index = 0; index < 2; index++) {
          composer.setTitle(`Task ${index}`);
          composer.setShareWithTeam(!expected);
          await composer.createTask();
          expect(createTask.mock.calls[index][5]?.shareWithTeam).toBe(
            !expected
          );
          expect(composer.shareWithTeam()).toBe(defaultSharing ?? !expected);
        }
        expect(createTask).toHaveBeenCalledTimes(2);
      } finally {
        dispose.dispose();
      }
    }
  );
});
