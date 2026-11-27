/** @vitest-environment jsdom */
import type { PropertyApiValues } from '@property/types';
import { QueryClient } from '@tanstack/solid-query';
import { createComputed, createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  loadTaskComposerDraft,
  saveTaskComposerDraft,
} from './taskComposerStorage';
import {
  createTaskSubmissionList,
  loadTaskSubmissions,
  submitTaskDraft,
  type TaskComposerSubmission,
} from './taskComposerSubmissions';

let client: QueryClient;
const submission: TaskComposerSubmission = {
  id: 'first',
  userId: 'alice',
  shareWithTeam: false,
  draft: {
    title: 'Offline task',
    content: 'Keep this description',
    propertyValues: {
      due: { valueType: 'DATE', value: new Date('2026-10-22T00:00:00Z') },
    },
    visiblePropertyIds: ['due'],
  },
};

beforeEach(() => {
  localStorage.clear();
  client = new QueryClient({
    defaultOptions: { mutations: { gcTime: Infinity } },
  });
});
afterEach(() => {
  client.clear();
  vi.restoreAllMocks();
});

it('saves before sending and recovers a pending request after a restart and prolonged outage', async () => {
  const response = Promise.withResolvers<{ documentId: string } | null>();
  const pending = submitTaskDraft(client, submission, () => {
    expect(loadTaskSubmissions('alice')[0].draft.content).toBe(
      'Keep this description'
    );
    return response.promise;
  });
  client = new QueryClient();
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const recovered = loadTaskSubmissions('alice')[0];
  expect(recovered.draft.title).toBe('Offline task');
  expect(recovered.draft.visiblePropertyIds).toEqual(['due']);
  expect(recovered.draft.propertyValues.due).toEqual({
    valueType: 'DATE',
    value: new Date('2026-10-22T00:00:00Z'),
  });
  expect(recovered.shareWithTeam).toBe(false);
  expect(loadTaskSubmissions('bob')).toEqual([]);
  expect(loadTaskSubmissions('alice', 'crm:one')).toEqual([]);
  response.resolve(null);
  await pending;
  expect(loadTaskSubmissions('alice')).toHaveLength(1);
});

it.each([true, false, null])(
  'recovers DATE_RANGE properties and template defaults with allDay=%s',
  async (allDay) => {
    const range: PropertyApiValues = {
      valueType: 'DATE_RANGE',
      value:
        allDay === null
          ? null
          : {
              allDay,
              start: new Date('2026-10-22T00:00:00Z'),
              end: new Date('2026-10-23T00:00:00Z'),
            },
    };
    const next: TaskComposerSubmission = {
      ...submission,
      draft: {
        ...submission.draft,
        propertyValues: { range },
        templateBaseline: {
          propertyIds: ['range'],
          propertyDefaults: { range },
          descriptionMarkdown: '',
        },
      },
    };
    saveTaskComposerDraft(next.draft);
    expect(loadTaskComposerDraft()?.propertyValues.range).toEqual(range);
    expect(
      loadTaskComposerDraft()?.templateBaseline?.propertyDefaults.range
    ).toEqual(range);
    await submitTaskDraft(client, next, async () => null);
    const recovered = loadTaskSubmissions('alice')[0];
    expect(recovered?.draft.propertyValues.range).toEqual(range);
    expect(recovered?.draft.templateBaseline?.propertyDefaults.range).toEqual(
      range
    );
  }
);

it('late success removes only its own submission and leaves newer composer input intact', async () => {
  const response = Promise.withResolvers<{ documentId: string }>();
  const pending = submitTaskDraft(client, submission, () => response.promise);
  await submitTaskDraft(
    client,
    {
      ...submission,
      id: 'second',
      draft: { ...submission.draft, title: 'Second task' },
    },
    async () => null
  );
  saveTaskComposerDraft({
    title: 'New input',
    content: 'New body',
    propertyValues: {},
  });
  response.resolve({ documentId: 'created' });
  await pending;
  expect(loadTaskSubmissions('alice').map((draft) => draft.id)).toEqual([
    'second',
  ]);
  expect(loadTaskComposerDraft()?.title).toBe('New input');
});

it('retains failed input without restoring over a newer draft', async () => {
  const response = Promise.withResolvers<null>();
  const pending = submitTaskDraft(client, submission, () => response.promise);
  saveTaskComposerDraft({
    title: 'Newer input',
    content: '',
    propertyValues: {},
  });
  response.resolve(null);
  await pending;
  expect(loadTaskSubmissions('alice')).toHaveLength(1);
  expect(loadTaskComposerDraft()?.title).toBe('Newer input');
});

it('does not resend the same pending submission from another composer', async () => {
  const response = Promise.withResolvers<null>();
  const create = vi.fn(() => response.promise);
  const pending = submitTaskDraft(client, submission, create);
  expect(await submitTaskDraft(client, submission, create)).toBeNull();
  response.resolve(null);
  await pending;
  expect(create).toHaveBeenCalledTimes(1);
});

it('keeps input after a rejected request without automatically retrying', async () => {
  const create = vi.fn(async () => {
    throw new Error('Connection lost');
  });
  await expect(submitTaskDraft(client, submission, create)).rejects.toThrow(
    'Connection lost'
  );
  expect(create).toHaveBeenCalledTimes(1);
  expect(loadTaskSubmissions('alice')).toHaveLength(1);
});

it('does not send or clear input when the durable save fails', async () => {
  const create = vi.fn(async () => ({ documentId: 'created' }));
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Quota exceeded');
  });
  await expect(submitTaskDraft(client, submission, create)).rejects.toThrow(
    'Quota exceeded'
  );
  expect(create).not.toHaveBeenCalled();
});

it('retires a confirmed create before project checks and does not turn their failure into a retry', async () => {
  const result = await submitTaskDraft(client, submission, async (confirm) => {
    confirm({ documentId: 'created' });
    expect(loadTaskSubmissions('alice')).toEqual([]);
    throw new Error('History update failed');
  });
  expect(result).toEqual({ documentId: 'created' });
});

it('preserves confirmed success when storage cleanup fails', async () => {
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new Error('Storage unavailable');
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(
    await submitTaskDraft(client, submission, async () => ({
      documentId: 'created',
    }))
  ).toEqual({ documentId: 'created' });
});

it('keeps an active request durable without offering recovery in a newly opened composer', async () => {
  const response = Promise.withResolvers<{ documentId: string }>();
  const pending = submitTaskDraft(client, submission, () => response.promise);
  const view = createRoot((dispose) => ({
    dispose,
    drafts: createTaskSubmissionList(client, 'alice'),
  }));
  expect(view.drafts()).toEqual([]);
  expect(loadTaskSubmissions('alice').map((draft) => draft.id)).toEqual([
    'first',
  ]);
  response.resolve({ documentId: 'created' });
  await pending;
  expect(view.drafts()).toEqual([]);
  view.dispose();
});

it.each(['none', 'saved'] as const)(
  'does not publish an active submission as recovery text with %s template selection',
  async (kind) => {
    const snapshots: string[][] = [];
    const view = createRoot((dispose) => {
      const drafts = createTaskSubmissionList(client, 'alice');
      createComputed(() => snapshots.push(drafts().map((draft) => draft.id)));
      return { dispose, drafts };
    });
    const input: TaskComposerSubmission = {
      ...submission,
      draft: {
        ...submission.draft,
        templateSelection:
          kind === 'none'
            ? { kind: 'none' }
            : {
                kind: 'saved',
                template: {
                  id: 'template-1',
                  name: 'Checklist',
                  revision: 1,
                  teamId: null,
                  contents: {
                    propertyIds: ['due'],
                    propertyDefaults: submission.draft.propertyValues,
                    descriptionMarkdown: 'Keep this description',
                  },
                },
              },
      },
    };
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<{ documentId: string }>();
    const pending = submitTaskDraft(client, input, () => {
      started.resolve();
      return response.promise;
    });
    await started.promise;
    expect(view.drafts()).toEqual([]);
    expect(loadTaskSubmissions('alice')[0].draft.content).toBe(
      'Keep this description'
    );
    response.resolve({ documentId: 'created' });
    await pending;
    expect(view.drafts()).toEqual([]);
    expect(snapshots.every((ids) => ids.length === 0)).toBe(true);
    view.dispose();
  }
);

it('offers an unconfirmed result only after the active attempt settles and hides retries', async () => {
  const view = createRoot((dispose) => ({
    dispose,
    drafts: createTaskSubmissionList(client, 'alice'),
  }));
  const started = Promise.withResolvers<void>();
  const response = Promise.withResolvers<null>();
  const pending = submitTaskDraft(client, submission, () => {
    started.resolve();
    return response.promise;
  });
  await started.promise;
  expect(view.drafts()).toEqual([]);
  response.resolve(null);
  await pending;
  expect(view.drafts()[0].draft.title).toBe('Offline task');

  const retryStarted = Promise.withResolvers<void>();
  const retryResponse = Promise.withResolvers<{ documentId: string }>();
  const retry = submitTaskDraft(client, submission, () => {
    retryStarted.resolve();
    return retryResponse.promise;
  });
  await retryStarted.promise;
  expect(view.drafts()).toEqual([]);
  retryResponse.resolve({ documentId: 'created' });
  await retry;
  expect(view.drafts()).toEqual([]);
  view.dispose();
});

it('skips invalid persisted entries without hiding a valid draft', async () => {
  await submitTaskDraft(client, submission, async () => null);
  const valid = localStorage.getItem('task-composer-submission:alice:first');
  expect(valid).not.toBeNull();
  const raw = JSON.parse(valid!);
  for (const [id, patch] of Object.entries({
    properties: {
      draft: {
        ...raw.draft,
        propertyValues: { due: { valueType: 'DATE', value: 'invalid' } },
      },
    },
    visible: { draft: { ...raw.draft, visiblePropertyIds: 12 } },
    sharing: { shareWithTeam: 'yes' },
  })) {
    localStorage.setItem(
      `task-composer-submission:alice:${id}`,
      JSON.stringify({ ...raw, id, ...patch })
    );
  }
  localStorage.setItem('task-composer-submission:alice:broken', '{');
  expect(loadTaskSubmissions('alice').map((draft) => draft.id)).toEqual([
    'first',
  ]);
});

it('recovers Markdown when an older editor envelope is malformed', async () => {
  await submitTaskDraft(client, submission, async () => null);
  const key = 'task-composer-submission:alice:first';
  const raw = JSON.parse(localStorage.getItem(key)!);
  raw.draft.editorState = { root: 'invalid' };
  localStorage.setItem(key, JSON.stringify(raw));
  const recovered = loadTaskSubmissions('alice')[0];
  expect(recovered.draft.editorState).toBeUndefined();
  expect(recovered.draft.content).toBe('Keep this description');
});
