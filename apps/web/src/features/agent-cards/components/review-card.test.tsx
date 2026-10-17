/**
 * @vitest-environment jsdom
 */

import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

type SessionState = {
  isPending: boolean;
  isError: boolean;
  data: { ownerId: string; canEdit: boolean; isArchived: boolean } | undefined;
};

const MAYA = 'macro|maya@macro.com';
const LEO = 'macro|leo@macro.com';

const state = vi.hoisted(() => ({
  reader: undefined as string | undefined,
  session: undefined as unknown,
}));

vi.mock('@app/features/agent-reviews/views/persisted-review', () => ({
  PersistedReview: (props: {
    sessionId: string;
    reviewId: string;
    canAct: boolean;
  }) => (
    <section
      aria-label="Saved review"
      data-session={props.sessionId}
      data-review={props.reviewId}
      data-can-act={String(props.canAct)}
    />
  ),
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => state.reader,
}));
vi.mock('@core/user', () => ({
  tryMacroId: (id: string) => id,
  getDisplayName: (id: string) => (id === MAYA ? 'Maya Chen' : ''),
}));
vi.mock('@queries/agent-session/session', () => ({
  useAgentSessionQuery: () => state.session,
}));

import { ReviewCard } from './review-card';

const REVIEW = '0199f3a2-1b2c-7d4e-8f90-a1b2c3d4e5f6';

const ready = (data: NonNullable<SessionState['data']>): SessionState => ({
  isPending: false,
  isError: false,
  data,
});

beforeEach(() => {
  state.reader = MAYA;
  state.session = ready({ ownerId: MAYA, canEdit: true, isArchived: false });
});
afterEach(cleanup);

const card = (drafts: 'email' | 'calendar' = 'email') =>
  render(() => (
    <ReviewCard sessionId="session-1" reviewId={REVIEW} drafts={drafts} />
  ));

it("is the saved review itself for the session's owner, who decides it", () => {
  const view = card();
  const review = view.getByRole('region', { name: 'Saved review' });
  expect(review.dataset.session).toBe('session-1');
  expect(review.dataset.review).toBe(REVIEW);
  expect(review.dataset.canAct).toBe('true');
});

it('is read-only for an owner who may no longer act on the session', () => {
  state.session = ready({ ownerId: MAYA, canEdit: true, isArchived: true });
  expect(
    card().getByRole('region', { name: 'Saved review' }).dataset.canAct
  ).toBe('false');
  cleanup();
  state.session = ready({ ownerId: MAYA, canEdit: false, isArchived: false });
  expect(
    card().getByRole('region', { name: 'Saved review' }).dataset.canAct
  ).toBe('false');
});

it('tells anyone else in the conversation whose drafts they are, and never loads them', () => {
  // Leo asked the agent in Maya's conversation: the drafts are still hers.
  state.reader = LEO;
  const view = card('calendar');
  expect(view.getByText('Event drafts to review')).toBeTruthy();
  expect(view.getByText('Waiting for Maya Chen')).toBeTruthy();
  expect(view.queryByRole('region', { name: 'Saved review' })).toBeNull();
});

it('names no one to a reader who cannot see the session', () => {
  state.reader = LEO;
  state.session = { isPending: false, isError: true, data: undefined };
  const view = card();
  expect(view.getByText('Email drafts to review')).toBeTruthy();
  expect(
    view.getByText('Waiting for the person the agent works for')
  ).toBeTruthy();
  expect(view.queryByRole('region', { name: 'Saved review' })).toBeNull();
});

it('loads nothing until both the session and the reader are known', () => {
  state.session = { isPending: true, isError: false, data: undefined };
  const view = card();
  expect(
    view.getByRole('status', { name: 'Loading drafts to review' })
  ).toBeTruthy();
  expect(view.queryByRole('region', { name: 'Saved review' })).toBeNull();
  cleanup();

  state.session = ready({ ownerId: MAYA, canEdit: true, isArchived: false });
  state.reader = undefined;
  const unknown = card();
  expect(unknown.queryByRole('region', { name: 'Saved review' })).toBeNull();
  expect(unknown.queryByText(/Waiting for/)).toBeNull();
});
