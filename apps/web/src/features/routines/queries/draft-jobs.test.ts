import { queryClient } from '@queries/client';
import type { DraftJob } from '@service-scheduled-action/generated/schemas';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  discardDraftJob,
  routineDraftJobsQueryOptions,
  startDraftJob,
} from './draft-jobs';
import { applyDraftUpdate } from './draft-jobs-sync';
import { scheduledActionKeys } from './keys';

const client = vi.hoisted(() => ({
  startRoutineDraftJob: vi.fn(),
  listRoutineDraftJobs: vi.fn(),
  discardRoutineDraftJob: vi.fn(),
}));
vi.mock('@service-scheduled-action/client', () => ({
  scheduledActionClient: client,
}));
vi.mock('@service-connection/websocket', async () => ({
  createConnectionWebsocketEffect: () => {},
  parseWebsocketPayload: (await import('@service-connection/websocket-payload'))
    .parseWebsocketPayload,
  ws: {},
}));
vi.mock('@macro-inc/collaboration/websocket', () => ({
  createReconnectEffect: () => {},
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});
vi.mock('@app/features/paywall/ai-usage-limit-handling', () => ({
  handleAiUsageLimitError: () => false,
}));

const KEY = scheduledActionKeys.draftJobs.queryKey;
const REQUEST = 'When an invoice arrives, label it Finance.';
const DROPPED = { code: 'NETWORK_ERROR', message: 'Network error occurred' };
const context = {
  timezone: 'America/New_York',
  defaultModel: 'claude',
  decisions: true,
  codeSteps: true,
};

function drafting(id: string, stage = 'started'): DraftJob {
  return {
    id,
    state: 'drafting',
    request: { kind: 'routine', description: REQUEST },
    progress: { stage },
    createdAt: '2026-11-12T10:00:00Z',
  } as DraftJob;
}

function failed(id: string): DraftJob {
  return {
    ...drafting(id),
    state: 'failed',
    message: 'Describe something a routine can do.',
    created: [],
    finishedAt: '2026-11-12T10:00:01Z',
  } as DraftJob;
}

const listed = () => queryClient.getQueryData<DraftJob[]>(KEY);

beforeEach(() => {
  queryClient.clear();
  client.startRoutineDraftJob.mockReset();
  client.listRoutineDraftJobs.mockReset();
  client.discardRoutineDraftJob.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('startDraftJob', () => {
  it('starts a draft and lists it at once, newest first', async () => {
    queryClient.setQueryData(KEY, [drafting('older')]);
    client.startRoutineDraftJob.mockResolvedValue(ok(drafting('new')));
    const job = await startDraftJob(REQUEST, context);
    expect(job).toMatchObject({ id: 'new', state: 'drafting' });
    expect(client.startRoutineDraftJob).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: expect.any(String),
        draft: { type: 'routine', description: REQUEST },
      })
    );
    expect(listed()?.map((each) => each.id)).toEqual(['new', 'older']);
  });

  it('sends the same start again when its connection drops', async () => {
    vi.useFakeTimers();
    client.startRoutineDraftJob
      .mockResolvedValueOnce(err([DROPPED]))
      .mockResolvedValueOnce(ok(drafting('new')));
    const started = startDraftJob(REQUEST, context);
    await vi.runAllTimersAsync();
    await expect(started).resolves.toMatchObject({ id: 'new' });
    const [first, second] = client.startRoutineDraftJob.mock.calls;
    // The server answers a repeat with the job the first one began.
    expect(second?.[0].clientId).toBe(first?.[0].clientId);
  });

  it('hands back a draft that failed at once without listing it', async () => {
    queryClient.setQueryData(KEY, []);
    client.startRoutineDraftJob.mockResolvedValue(ok(failed('refused')));
    await expect(startDraftJob(REQUEST, context)).resolves.toMatchObject({
      state: 'failed',
    });
    // Listed, it would also be reported by a toast.
    expect(listed()).toEqual([]);
  });

  it('says why a draft didn’t start', async () => {
    client.startRoutineDraftJob.mockResolvedValue(
      err([{ code: 'TOO_MANY', message: 'Too many' }])
    );
    await expect(startDraftJob(REQUEST, context)).resolves.toBe(
      'Too many routines are drafting. Wait for one to finish, or cancel one.'
    );
  });
});

describe('background draft updates', () => {
  it('moves a draft’s progress on in place', () => {
    queryClient.setQueryData(KEY, [drafting('a'), drafting('b')]);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    applyDraftUpdate(
      JSON.stringify({
        draftId: 'a',
        state: 'drafting',
        progress: { stage: 'writing' },
      })
    );
    expect(listed()?.map((each) => each.progress.stage)).toEqual([
      'writing',
      'started',
    ]);
    // A stage a newer server reports still moves it on.
    applyDraftUpdate({
      draftId: 'b',
      state: 'drafting',
      progress: { stage: 'polishing' },
    });
    expect(listed()?.[1]?.progress.stage).toBe('polishing');
    expect(invalidate).not.toHaveBeenCalled();
    invalidate.mockRestore();
  });

  it('reads the list again for a finished draft or one started elsewhere', () => {
    queryClient.setQueryData(KEY, [drafting('a')]);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    applyDraftUpdate({
      draftId: 'a',
      state: 'ready',
      progress: { stage: 'checked' },
    });
    applyDraftUpdate({
      draftId: 'other-tab',
      state: 'drafting',
      progress: { stage: 'started' },
    });
    expect(invalidate).toHaveBeenCalledTimes(2);
    invalidate.mockRestore();
  });

  it('drops a draft removed elsewhere, and ignores what it can’t read', () => {
    queryClient.setQueryData(KEY, [drafting('a'), drafting('b')]);
    applyDraftUpdate({ draftId: 'a', state: 'removed', progress: {} });
    applyDraftUpdate('{not json');
    applyDraftUpdate({ draftId: 'b', state: 'exploded', progress: {} });
    expect(listed()?.map((each) => each.id)).toEqual(['b']);
  });
});

describe('discardDraftJob', () => {
  it('takes a draft out at once, and a read already under way keeps it out', async () => {
    queryClient.setQueryData(KEY, [drafting('a'), drafting('b')]);
    client.discardRoutineDraftJob.mockResolvedValue(ok(undefined));
    discardDraftJob('a');
    expect(listed()?.map((each) => each.id)).toEqual(['b']);
    // This read started before the server heard of the discard.
    client.listRoutineDraftJobs.mockResolvedValue(
      ok([drafting('a'), drafting('b')])
    );
    const jobs = await queryClient.fetchQuery(routineDraftJobsQueryOptions());
    expect(jobs.map((each) => each.id)).toEqual(['b']);
    // Its progress doesn't bring it back either.
    applyDraftUpdate({
      draftId: 'a',
      state: 'drafting',
      progress: { stage: 'writing' },
    });
    expect(listed()?.map((each) => each.id)).toEqual(['b']);
  });

  it('lists a draft again when the server refused to discard it', async () => {
    queryClient.setQueryData(KEY, [drafting('kept')]);
    client.discardRoutineDraftJob.mockResolvedValue(
      err([{ code: 'HTTP_ERROR', message: 'boom' }])
    );
    client.listRoutineDraftJobs.mockResolvedValue(ok([drafting('kept')]));
    discardDraftJob('kept');
    expect(listed()).toEqual([]);
    await vi.waitFor(async () => {
      const jobs = await queryClient.fetchQuery({
        ...routineDraftJobsQueryOptions(),
        staleTime: 0,
      });
      expect(jobs.map((each) => each.id)).toEqual(['kept']);
    });
  });
});
