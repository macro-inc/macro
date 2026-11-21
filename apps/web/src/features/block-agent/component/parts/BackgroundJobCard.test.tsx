import { t } from '@app/lib/i18n';
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
  expect(jobOutcome('interrupted')).toBe('Stopped: outcome unknown');
  // A job that settled before its program started says it didn't run.
  expect(jobOutcome('interrupted', true)).toBe("Didn't run");
  expect(jobOutcome('timed_out', true)).toBe("Didn't run");
});

it('shows a job that never ran muted, not as a failure', () => {
  const view = render(() => (
    <BackgroundJobCard
      jobId="job-1"
      job={{
        title: 'Scanning inbox',
        startedAt: new Date().toISOString(),
        status: 'timed_out',
        neverRan: true,
        activity: [],
      }}
    />
  ));
  expect(view.getAllByText("Didn't run")).not.toHaveLength(0);
  expect(
    view.container.querySelector('[data-tool-status="failed"]')
  ).toBeNull();
});

it('names running jobs as jobs in the composer chip', () => {
  expect(t('agentJobs.running', { count: 1 })).toBe('1 job running');
  expect(t('agentJobs.running', { count: 3 })).toBe('3 jobs running');
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
  // A cancel the person asked for reads muted, not as a failure.
  expect(
    ended.container.querySelector('[data-tool-status="failed"]')
  ).toBeNull();
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
