import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import {
  BackgroundJobCard,
  elapsedLabel,
  jobOutcome,
} from './BackgroundJobCard';

afterEach(cleanup);

it('counts minutes and seconds since the job started', () => {
  const started = '2026-11-19T10:00:00Z';
  expect(elapsedLabel(started, Date.parse(started) + 65_000)).toBe('1:05');
  expect(elapsedLabel(started, Date.parse(started) - 1_000)).toBe('0:00');
  expect(elapsedLabel('not a time', 0)).toBe('0:00');
});

it('says how a settled job ended and nothing while it runs', () => {
  expect(jobOutcome('running')).toBeUndefined();
  expect(jobOutcome('succeeded')).toBe('Done');
  expect(jobOutcome('interrupted')).toBe('Interrupted');
});

it('offers Cancel while the job runs and stops offering it once it ends', async () => {
  const cancel = vi.fn();
  const job = {
    title: 'Checking routine',
    startedAt: new Date().toISOString(),
    status: 'running' as const,
    activity: [{ id: 1, label: 'Check routine', status: 'running' as const }],
  };
  const view = render(() => (
    <BackgroundJobCard jobId="job-1" job={job} onCancel={cancel} />
  ));
  expect(view.getAllByText('Checking routine')).not.toHaveLength(0);
  expect(view.getAllByText('Check routine')).not.toHaveLength(0);
  fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
  expect(cancel).toHaveBeenCalledOnce();
  cleanup();

  const ended = render(() => (
    <BackgroundJobCard
      jobId="job-1"
      job={{ ...job, status: 'cancelled' }}
      onCancel={cancel}
    />
  ));
  expect(ended.getAllByText('Cancelled')).not.toHaveLength(0);
  expect(ended.queryByRole('button', { name: 'Cancel' })).toBeNull();
});

it('puts Cancel in an overflow menu when the view asks for one', () => {
  const view = render(() => (
    <BackgroundJobCard
      jobId="job-1"
      job={{
        title: 'Checking routine',
        startedAt: new Date().toISOString(),
        status: 'running',
        activity: [],
      }}
      onCancel={vi.fn()}
      cancelInMenu
    />
  ));
  expect(view.queryByRole('button', { name: 'Cancel' })).toBeNull();
  expect(
    view.getByRole('button', { name: 'Background job actions' })
  ).toBeTruthy();
});
