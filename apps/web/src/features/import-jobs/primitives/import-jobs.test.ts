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

  // A failure stays, hours later, until it is dismissed...
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

it('keeps an import that finished with failures until it is dismissed', () => {
  const { jobs, dispose } = createRoot((dispose) => ({
    dispose,
    ...createImportJobs({
      runs: {
        runs: () => [
          {
            source: 'notion',
            status: 'completed',
            error: '2 objects could not be imported. Plan again to retry them.',
            updated_at: '2026-11-06T12:00:00Z',
          },
          {
            source: 'linear',
            status: 'failed',
            error_kind: 'a_kind_from_a_newer_server' as never,
            updated_at: '2026-11-06T12:00:00Z',
          },
        ],
        slackChannelsImporting: () => 0,
      },
      createReport: () => () => undefined,
      dismissals: { restore: () => [], save: () => {} },
    }),
  }));
  vi.advanceTimersByTime(60_000);
  expect(jobs().map((job) => job.phase)).toEqual([
    { kind: 'completed', partial: true },
    // An unknown kind still lists, read as Macro's side.
    { kind: 'failed', errorKind: 'internal' },
  ]);
  dispose();
});

it('stops listing a failure nobody dismissed after a week', () => {
  const { jobs, dispose } = createRoot((dispose) => ({
    dispose,
    ...createImportJobs({
      runs: {
        runs: () => [
          {
            source: 'notion',
            status: 'failed',
            error_kind: 'unreachable',
            updated_at: '2026-11-06T12:00:00Z',
          },
        ],
        slackChannelsImporting: () => 0,
      },
      createReport: () => () => undefined,
      dismissals: { restore: () => [], save: () => {} },
    }),
  }));
  vi.advanceTimersByTime(6 * 24 * 60 * 60 * 1000);
  expect(jobs()).toHaveLength(1);
  vi.advanceTimersByTime(24 * 60 * 60 * 1000);
  expect(jobs()).toEqual([]);
  dispose();
});

it('keeps a partly failed import listed however old, until dismissed', () => {
  const { jobs, dispose } = createRoot((dispose) => ({
    dispose,
    ...createImportJobs({
      runs: {
        runs: () => [
          {
            source: 'linear',
            status: 'completed',
            error: '2 objects could not be imported. Plan again to retry them.',
            updated_at: '2026-10-27T12:00:00Z',
          },
        ],
        slackChannelsImporting: () => 0,
      },
      createReport: () => () => undefined,
      dismissals: { restore: () => [], save: () => {} },
    }),
  }));
  // Ten days after it finished.
  expect(jobs().map((job) => job.phase)).toEqual([
    { kind: 'completed', partial: true },
  ]);
  dispose();
});

it('hides an entry the review card dismissed, now and after a reload', () => {
  const failed = {
    source: 'notion' as const,
    status: 'failed' as const,
    error_kind: 'connection_unavailable' as const,
    updated_at: '2026-11-06T11:00:00Z',
  };
  let stored: readonly string[] = [];
  const listeners: (() => void)[] = [];
  const dismissals = {
    restore: () => stored,
    save: (keys: readonly string[]) => {
      stored = keys;
    },
    subscribe: (onChange: () => void) => {
      listeners.push(onChange);
      return () => {};
    },
  };
  const tray = createRoot((dispose) => ({
    dispose,
    ...createImportJobs({
      runs: { runs: () => [failed], slackChannelsImporting: () => 0 },
      createReport: () => () => undefined,
      dismissals,
    }),
  }));
  expect(tray.jobs()).toHaveLength(1);

  // The card records the dismissal and tells the tray.
  stored = ['notion:failed:2026-11-06T11:00:00Z'];
  for (const listener of listeners) listener();
  expect(tray.jobs()).toEqual([]);
  tray.dispose();

  const reloaded = createRoot((dispose) => ({
    dispose,
    ...createImportJobs({
      runs: { runs: () => [failed], slackChannelsImporting: () => 0 },
      createReport: () => () => undefined,
      dismissals,
    }),
  }));
  expect(reloaded.jobs()).toEqual([]);
  reloaded.dispose();
});
