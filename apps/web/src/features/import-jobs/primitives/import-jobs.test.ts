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

it('drops a settled run an hour after its last change while nothing else moves', () => {
  const { jobs, dispose } = createRoot((dispose) => ({
    dispose,
    ...createImportJobs({
      runs: {
        runs: () => [
          {
            source: 'linear',
            status: 'completed',
            updated_at: '2026-11-06T11:01:00Z',
          },
        ],
        slackChannelsImporting: () => 0,
      },
      createReport: () => () => undefined,
    }),
  }));
  expect(jobs().map((job) => job.source)).toEqual(['linear']);

  vi.advanceTimersByTime(60 * 1000);
  expect(jobs()).toEqual([]);
  dispose();
});
