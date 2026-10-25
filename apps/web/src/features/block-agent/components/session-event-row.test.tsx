import type { SessionNotification } from '@service-agent-fold/generated/types';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { SessionEventRow } from './session-event-row';

const base = {
  id: 'event',
  subjectId: 'review-id',
  createdAt: '2026-10-22T12:00:00Z',
  turn: 1,
  actionId: 'action',
  systemTurn: true,
};
afterEach(cleanup);

it('renders the connected app, relative age and exact timestamp', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-22T12:05:00Z'));
  try {
    const view = render(() => (
      <SessionEventRow
        event={{ ...base, kind: 'app.connected', payload: { app: 'Notion' } }}
      />
    ));
    expect(view.getByRole('status').textContent).toContain('Notion connected');
    const time = view.getByText('5m');
    expect(time.getAttribute('datetime')).toBe(base.createdAt);
    expect(time.getAttribute('title')).toBe(
      new Date(base.createdAt).toLocaleString(undefined, {
        dateStyle: 'full',
        timeStyle: 'long',
      })
    );
    expect(view.queryByRole('button')).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it('summarizes a partial decision and opens the exact review subject', async () => {
  const open = vi.fn();
  const view = render(() => (
    <SessionEventRow
      viewerId="owner"
      onOpenReview={open}
      event={{
        ...base,
        kind: 'review.decided',
        payload: {
          by: 'owner',
          via: 'card',
          outcome: 'partial',
          items: [
            { id: '1', status: 'completed', edited: false },
            { id: '2', status: 'completed', edited: true },
            { id: '3', status: 'submitting', edited: false },
            {
              id: '4',
              status: 'unknown',
              edited: false,
              error: 'Provider rejected',
            },
          ],
        },
      }}
    />
  ));
  expect(view.getByRole('status').textContent).toContain(
    'You approved 3 of 4 items · 1 failed'
  );
  expect(view.getByRole('status').classList.contains('text-failure')).toBe(
    true
  );
  await fireEvent.click(view.getByRole('button', { name: 'View review' }));
  expect(open).toHaveBeenCalledExactlyOnceWith('review-id');
});

it('reports settled results and keeps unconfirmed outcomes distinct from failures', () => {
  const view = render(() => (
    <SessionEventRow
      event={{
        ...base,
        kind: 'review.settled',
        payload: {
          by: 'owner',
          via: 'chat',
          outcome: 'partial',
          items: [
            { id: '1', status: 'completed', edited: false },
            { id: '2', status: 'unknown', edited: false },
          ],
        },
      }}
    />
  ));
  expect(view.getByRole('status').textContent).toContain(
    'Review finished · 1 of 2 items completed · 1 unconfirmed'
  );
  expect(view.queryByRole('button')).toBeNull();
});

it('describes a dismissal without calling it completed work', () => {
  const view = render(() => (
    <SessionEventRow
      event={{
        ...base,
        kind: 'review.decided',
        payload: {
          by: 'owner',
          via: 'inbox',
          outcome: 'dismissed',
          items: [{ id: '1', status: 'dismissed', edited: false }],
        },
      }}
    />
  ));
  expect(view.getByRole('status').textContent).toContain(
    'Owner dismissed 1 item'
  );
});

it('keeps a safe fallback for events from a newer server', () => {
  const event: SessionNotification = JSON.parse(
    JSON.stringify({ ...base, kind: 'future.kind', payload: { extra: true } })
  );
  const view = render(() => <SessionEventRow event={event} />);
  expect(view.getByRole('status').textContent).toContain('System event');
});

it('announces a ready import plan with its counts and opens its review', async () => {
  const open = vi.fn();
  const view = render(() => (
    <SessionEventRow
      onOpenReview={open}
      event={{
        ...base,
        kind: 'import.planned',
        payload: { copy: 12, taskLists: 1, skipped: 3, byHand: 2 },
      }}
    />
  ));
  expect(view.getByRole('status').textContent).toContain(
    'Import plan ready · 12 to copy · 1 task list · 2 by hand'
  );
  await fireEvent.click(view.getByRole('button', { name: 'View review' }));
  expect(open).toHaveBeenCalledExactlyOnceWith('review-id');
});

it('reports a settled import from its counts, never its error text', () => {
  const view = render(() => (
    <SessionEventRow
      event={{
        ...base,
        kind: 'review.settled',
        payload: {
          import: {
            outcome: 'failed',
            error: 'Notion said: Secret roadmap',
            imported: 4,
            planned: 10,
            documents: 8,
            databases: 1,
            databaseRows: 20,
            taskLists: 1,
            taskRows: 5,
            skipped: 2,
            notWritten: 6,
            sharedWithTeam: 0,
            alreadyInMacro: 0,
            waitingOnTeammates: 0,
            rootFolderId: null,
            failures: [{ title: 'Roadmap', url: null, reason: null }],
            handItems: [],
          },
        },
      }}
    />
  ));
  const status = view.getByRole('status');
  expect(status.textContent).toContain(
    'Import failed · 4 of 10 imported · 1 failed'
  );
  expect(status.textContent).not.toContain('Secret roadmap');
  expect(status.classList.contains('text-failure')).toBe(true);
});
