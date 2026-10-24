import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { RunCard } from '../core/run-cards';

const mounts = vi.hoisted(() => ({ data: 0, view: 0 }));
vi.mock('@app/features/dynamic-ui/DashboardToolView.lazy', () => ({
  DashboardToolView: () => {
    mounts.view += 1;
    return <section aria-label="View" />;
  },
}));
vi.mock('@app/features/agent-cards/components/data-card', () => ({
  DataCard: (props: { sql: string; display?: string | null }) => {
    mounts.data += 1;
    return (
      <p>
        {props.sql} · {props.display ?? 'table'}
      </p>
    );
  },
}));
vi.mock('./review-card', () => ({
  ReviewCard: (props: {
    sessionId: string;
    reviewId: string;
    drafts: string;
  }) => (
    <section aria-label="Review">
      {props.sessionId}/{props.reviewId}/{props.drafts}
    </section>
  ),
}));

import RunCards from './run-cards';

afterEach(() => {
  cleanup();
  mounts.data = 0;
  mounts.view = 0;
});

function cards(): RunCard[] {
  return [
    { kind: 'view', key: 't1', rowId: 't1', view: { widgets: [] } },
    { kind: 'data', key: 't2', rowId: 't2', sql: 'SELECT 1', display: 'bar' },
  ];
}

it('keeps each card mounted while a live run works its cards out again', async () => {
  const [current, setCurrent] = createSignal(cards());
  const view = render(() => <RunCards cards={current()} />);
  await view.findByRole('region', { name: 'View' });
  // Every paint of a live run builds new card objects under the same keys.
  setCurrent(cards());
  setCurrent(cards());
  expect(view.getByText('SELECT 1 · bar')).toBeTruthy();
  expect(mounts).toEqual({ data: 1, view: 1 });
});

const review: RunCard = {
  kind: 'review',
  key: 'review:r-1',
  rowId: 'review_r-1',
  reviewId: 'r-1',
  drafts: 'email',
};

it('opens drafts saved for review in the session the run is in', async () => {
  const view = render(() => <RunCards cards={[review]} sessionId="s-1" />);
  const card = await view.findByRole('region', { name: 'Review' });
  expect(card.textContent).toBe('s-1/r-1/email');
});

it('shows no review without the session it was saved in', async () => {
  const view = render(() => <RunCards cards={[review]} />);
  await Promise.resolve();
  expect(view.queryByRole('region', { name: 'Review' })).toBeNull();
});
