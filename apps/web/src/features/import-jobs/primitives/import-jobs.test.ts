import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createImportJobs } from './import-jobs';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-11-06T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

it('drops a plan waiting for approval an hour after its last change while nothing else moves', () => {
  const { jobs, dispose } = createRoot((dispose) => ({
    dispose,
    ...createImportJobs({
      runs: {
        runs: () => [
          {
            source: 'linear',
            status: 'ready',
            updated_at: '2026-11-06T11:01:00Z',
          },
        ],
        slackChannelsImporting: () => 0,
      },
      createReport: () => () => undefined,
      dismissals: { restore: () => [], save: () => {} },
    }),
  }));
  expect(jobs().map((job) => job.source)).toEqual(['linear']);

  vi.advanceTimersByTime(60 * 1000);
  expect(jobs()).toEqual([]);
  dispose();
});

it('lets a finished import go after a few seconds and keeps a failure until dismissed', () => {
  const { jobs, dismiss, dispose } = createRoot((dispose) => ({
    dispose,
    ...createImportJobs({
      runs: {
        runs: () => [
          {
            source: 'notion',
            status: 'completed',
            updated_at: '2026-11-06T12:00:00Z',
          },
          {
            source: 'jira',
            status: 'failed',
            error_kind: 'access_lost',
            updated_at: '2026-11-06T12:00:00Z',
          },
        ],
        slackChannelsImporting: () => 0,
      },
      createReport: () => () => undefined,
      dismissals: { restore: () => [], save: () => {} },
    }),
  }));
  expect(jobs().map((job) => job.source)).toEqual(['notion', 'jira']);

  vi.advanceTimersByTime(5_000);
  expect(jobs().map((job) => job.source)).toEqual(['jira']);

  // A failure stays, hours later, until it is dismissed.
  vi.advanceTimersByTime(3 * 60 * 60 * 1000);
  expect(jobs().map((job) => job.source)).toEqual(['jira']);
  const [failed] = jobs();
  dismiss(failed.key);
  expect(jobs()).toEqual([]);
  dispose();
});

it('remembers a dismissed failure across reloads', () => {
  const failed = {
    source: 'jira' as const,
    status: 'failed' as const,
    error_kind: 'access_lost' as const,
    updated_at: '2026-11-06T11:00:00Z',
  };
  const saved: (readonly string[])[] = [];
  const first = createRoot((dispose) => ({
    dispose,
    ...createImportJobs({
      runs: { runs: () => [failed], slackChannelsImporting: () => 0 },
      createReport: () => () => undefined,
      dismissals: { restore: () => [], save: (keys) => saved.push(keys) },
    }),
  }));
  const [job] = first.jobs();
  first.dismiss(job.key);
  expect(first.jobs()).toEqual([]);
  expect(saved.at(-1)).toEqual([job.key]);
  first.dispose();

  // A new tray (a reload) restores it, so the failure stays dismissed.
  const second = createRoot((dispose) => ({
    dispose,
    ...createImportJobs({
      runs: { runs: () => [failed], slackChannelsImporting: () => 0 },
      createReport: () => () => undefined,
      dismissals: { restore: () => saved.at(-1) ?? [], save: () => {} },
    }),
  }));
  expect(second.jobs()).toEqual([]);
  second.dispose();
});
