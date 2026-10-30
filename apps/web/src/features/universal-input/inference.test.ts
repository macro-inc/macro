import { UniversalInputRequestError } from '@service-agent-harness/universal-input-error';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  TASK_PRIORITY_OPTIONS,
  TASK_STATUS_OPTIONS,
} from '../next-soup/core/search-options';
import { createInferenceSource } from './inference';

const { extract } = vi.hoisted(() => ({ extract: vi.fn() }));
vi.mock('@service-agent-harness/universal-input', () => ({
  universalInputClient: { extract },
}));
beforeEach(() => {
  extract.mockReset();
  extract.mockImplementation(async (_text, intent, revision) => ({
    intent,
    revision,
    suggestions: { recipients: [], guests: [], from: [], in: [] },
  }));
});

it('waits for the task field catalog before invoking extraction', async () => {
  const catalog = [{ name: 'Priority', options: ['Urgent'] }];
  let ready!: (value: typeof catalog) => void;
  const properties = () =>
    new Promise<typeof catalog>((resolve) => {
      ready = resolve;
    });
  const source = createInferenceSource(properties);
  const result = source.extract('Fix clicks\npriority urgent', 'task', 7);
  expect(extract).not.toHaveBeenCalled();
  ready(catalog);
  await result;
  expect(extract).toHaveBeenCalledWith(
    'Fix clicks\npriority urgent',
    'task',
    7,
    catalog,
    undefined,
    expect.objectContaining({ end: expect.any(Function) })
  );
});

it('extracts email immediately without waiting for unrelated task metadata', async () => {
  const properties = vi.fn(
    () => new Promise<{ name: string; options: string[] }[]>(() => {})
  );
  await createInferenceSource(properties).extract('Email Julia', 'email', 2);
  expect(properties).not.toHaveBeenCalled();
  expect(extract).toHaveBeenCalledWith(
    'Email Julia',
    'email',
    2,
    [],
    undefined,
    expect.objectContaining({ end: expect.any(Function) })
  );
});

it('adapts raw extracted search fields without reinterpreting the keyword phrase', async () => {
  extract.mockResolvedValue({
    revision: 3,
    intent: 'search',
    suggestions: {
      recipients: [],
      guests: [],
      query: 'growth in 2026',
      type: 'channels',
      from: ['Julia'],
      in: ['sales'],
    },
  });
  const result = await createInferenceSource().extract(
    'search messages from Julia in sales about growth in 2026',
    'search',
    3
  );
  expect(result.revision).toBe(3);
  expect(result.suggestions.query).toBe('growth in 2026');
  expect(result.suggestions.searchFilters).toMatchObject({
    type: 'channels',
    channels: { from: ['Julia'], in: ['sales'] },
  });
  expect(result.suggestions).not.toHaveProperty('from');
});

it('adapts recurrence into the shared calendar editor config and retains copies', async () => {
  extract.mockResolvedValue({
    revision: 4,
    intent: 'calendar',
    suggestions: {
      recurrence: {
        frequency: 'WEEKLY',
        interval: 2,
        by_day: ['MO'],
        monthly_by_day: null,
        ends: { kind: 'after', count: 5 },
      },
    },
  });
  const result = await createInferenceSource().extract(
    'Meet every other Monday five times',
    'calendar',
    4
  );
  expect(result.suggestions.recurrence).toEqual({
    frequency: 'WEEKLY',
    interval: 2,
    byDay: ['MO'],
    ends: { kind: 'after', count: 5 },
  });
  extract.mockResolvedValue({
    revision: 5,
    intent: 'email',
    suggestions: { cc: ['Julia'], bcc: ['investor@example.org'] },
  });
  const email = await createInferenceSource().extract(
    'email John cc Julia bcc investor@example.org',
    'email',
    5
  );
  expect(email.suggestions.cc).toEqual(['Julia']);
  expect(email.suggestions.bcc).toEqual(['investor@example.org']);
});

it('supplies the shared search option catalog and a manually selected type', async () => {
  extract.mockResolvedValue({
    revision: 9,
    intent: 'search',
    suggestions: {
      type: 'task',
      query: 'android',
      status: [],
      priority: ['High'],
      assignees: [],
      created_by: [],
    },
  });
  await createInferenceSource().extract(
    'search high priority tasks about android',
    'search',
    9,
    'task'
  );
  expect(extract).toHaveBeenCalledWith(
    'search high priority tasks about android',
    'search',
    9,
    [
      {
        name: 'Status',
        options: TASK_STATUS_OPTIONS.map((option) => option.label),
      },
      {
        name: 'Priority',
        options: TASK_PRIORITY_OPTIONS.map((option) => option.label),
      },
    ],
    'task',
    expect.objectContaining({ end: expect.any(Function) })
  );
});

it('does not send extraction after disposal while the catalog is pending', async () => {
  let ready!: (value: { name: string; options: string[] }[]) => void;
  const source = createInferenceSource(
    () =>
      new Promise((resolve) => {
        ready = resolve;
      })
  );
  const result = source.extract('Fix mobile notifications', 'task', 1);
  source.dispose();
  ready([]);
  await expect(result).rejects.toMatchObject({ kind: 'unavailable' });
  expect(extract).not.toHaveBeenCalled();
});

it('replaces provider errors with a safe category instead of draft-containing details', async () => {
  extract.mockRejectedValue(new UniversalInputRequestError('RATE_LIMITED'));
  await expect(
    createInferenceSource().extract('Email private@example.org', 'email', 1)
  ).rejects.toMatchObject({ kind: 'rate_limit' });
  extract.mockRejectedValue(
    new Error('Failed extracting private@example.org secret body')
  );
  const result = createInferenceSource().extract(
    'Email private@example.org',
    'email',
    2
  );
  await expect(result).rejects.toMatchObject({ kind: 'unknown' });
  await expect(result).rejects.not.toThrow('private@example.org');
});
