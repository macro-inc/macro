import { resetQueryAccountSession } from '@queries/auth/account-scope';
import { authKeys } from '@queries/auth/keys';
import { queryClient } from '@queries/client';
import type { DraftJob } from '@service-scheduled-action/generated/schemas';
import { QueryClientProvider, QueryObserver } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { createComponent, createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  discardDraftJob,
  routineDraftJobsQueryOptions,
  startDraftJob,
  useDraftJobs,
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

  it('keeps a draft just started when a read under way missed it', async () => {
    let answer: (jobs: unknown) => void = () => {};
    client.listRoutineDraftJobs.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      })
    );
    const read = queryClient.prefetchQuery(routineDraftJobsQueryOptions());
    client.startRoutineDraftJob.mockResolvedValue(ok(drafting('new')));
    client.listRoutineDraftJobs.mockResolvedValue(ok([drafting('new')]));
    await startDraftJob(REQUEST, context);
    // The read began before the start, so its answer leaves the draft out.
    answer(ok([]));
    await read;
    expect(listed()?.map((each) => each.id)).toEqual(['new']);
    // And the list is read again, now that it has the draft.
    expect(queryClient.getQueryState(KEY)?.isInvalidated).toBe(true);
  });

  it('keeps a draft its updates moved on before its start answered', async () => {
    // Updates came first: one draft got further, the other finished.
    const moved = drafting('moved', 'writing');
    queryClient.setQueryData(KEY, [moved, failed('finished')]);
    client.startRoutineDraftJob
      .mockResolvedValueOnce(ok(drafting('moved')))
      .mockResolvedValueOnce(ok(drafting('finished')));
    await startDraftJob(REQUEST, context);
    await startDraftJob(REQUEST, context);
    expect(listed()).toEqual([moved, failed('finished')]);
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

  it('keeps reading a finished draft while its server restarts', async () => {
    vi.useFakeTimers();
    queryClient.setQueryData(KEY, [drafting('a')]);
    const observer = new QueryObserver(
      queryClient,
      routineDraftJobsQueryOptions()
    );
    const stop = observer.subscribe(() => {});
    // The replica that failed it is shutting down; the next one isn't up yet.
    const away = err([{ code: 'HTTP_ERROR', message: 'Bad gateway' }]);
    client.listRoutineDraftJobs
      .mockResolvedValueOnce(away)
      .mockResolvedValueOnce(away)
      .mockResolvedValueOnce(away)
      .mockResolvedValueOnce(away)
      .mockResolvedValueOnce(away)
      .mockResolvedValue(ok([failed('a')]));
    applyDraftUpdate({
      draftId: 'a',
      state: 'failed',
      progress: { stage: 'writing' },
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(listed()?.[0]?.state).toBe('failed');
    expect(client.listRoutineDraftJobs).toHaveBeenCalledTimes(6);
    stop();
  });

  it('drops a draft removed elsewhere, and ignores what it can’t read', () => {
    queryClient.setQueryData(KEY, [drafting('a'), drafting('b')]);
    applyDraftUpdate({ draftId: 'a', state: 'removed', progress: {} });
    applyDraftUpdate('{not json');
    applyDraftUpdate({ draftId: 'b', state: 'exploded', progress: {} });
    expect(listed()?.map((each) => each.id)).toEqual(['b']);
  });

  it('keeps a draft removed elsewhere out of a read already under way', async () => {
    queryClient.setQueryData(KEY, [drafting('a'), drafting('b')]);
    const read = Promise.withResolvers<unknown>();
    client.listRoutineDraftJobs.mockReturnValueOnce(read.promise);
    const reading = queryClient.fetchQuery({
      ...routineDraftJobsQueryOptions(),
      staleTime: 0,
    });
    applyDraftUpdate({ draftId: 'a', state: 'removed', progress: {} });
    // This read started before the server removed it.
    read.resolve(ok([drafting('a'), drafting('b')]));
    await reading;
    expect(listed()?.map((each) => each.id)).toEqual(['b']);
  });
});

/** `useDraftJobs` mounted as the app mounts it, until `dispose` runs. */
function mountDraftJobs() {
  return createRoot((dispose) => {
    let drafts: ReturnType<typeof useDraftJobs> | undefined;
    createComponent(QueryClientProvider, {
      client: queryClient,
      get children() {
        // A component, so its body runs untracked as the app's does.
        return createComponent(() => {
          drafts = useDraftJobs(() => true);
          return null;
        }, {});
      },
    });
    if (!drafts) throw new Error('useDraftJobs did not mount');
    return { drafts, dispose };
  });
}

const BAD_GATEWAY = err([{ code: 'HTTP_ERROR', message: 'Bad gateway' }]);

describe('useDraftJobs', () => {
  it('keeps listing its drafts when reading them again fails', async () => {
    vi.useFakeTimers();
    queryClient.setQueryData(KEY, [drafting('a')]);
    client.listRoutineDraftJobs.mockResolvedValue(BAD_GATEWAY);
    const { drafts, dispose } = mountDraftJobs();
    queryClient.invalidateQueries({ queryKey: KEY });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(queryClient.getQueryState(KEY)?.status).toBe('error');
    expect(drafts.jobs().map((job) => job.id)).toEqual(['a']);
    expect(drafts.loaded()).toBe(true);
    dispose();
  });

  it('lists nothing, and hasn’t read them, while the first read fails', async () => {
    vi.useFakeTimers();
    client.listRoutineDraftJobs.mockResolvedValue(BAD_GATEWAY);
    const { drafts, dispose } = mountDraftJobs();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(queryClient.getQueryState(KEY)?.status).toBe('error');
    expect(drafts.jobs()).toEqual([]);
    expect(drafts.loaded()).toBe(false);
    dispose();
  });

  it('reads them again once a login that replaced the session is confirmed', async () => {
    vi.useFakeTimers();
    client.listRoutineDraftJobs.mockResolvedValue(ok([drafting('mine')]));
    const { drafts, dispose } = mountDraftJobs();
    await vi.advanceTimersByTimeAsync(0);
    expect(drafts.jobs().map((job) => job.id)).toEqual(['mine']);

    client.listRoutineDraftJobs.mockResolvedValue(ok([drafting('theirs')]));
    client.listRoutineDraftJobs.mockClear();
    await resetQueryAccountSession();
    await vi.advanceTimersByTimeAsync(1000);
    expect(drafts.jobs()).toEqual([]);
    expect(client.listRoutineDraftJobs).not.toHaveBeenCalled();

    await queryClient.fetchQuery({
      queryKey: authKeys.userInfo.queryKey,
      queryFn: () => ({ id: 'someone-else', authenticated: true }),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(client.listRoutineDraftJobs).toHaveBeenCalledTimes(1);
    expect(drafts.jobs().map((job) => job.id)).toEqual(['theirs']);
    dispose();
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
