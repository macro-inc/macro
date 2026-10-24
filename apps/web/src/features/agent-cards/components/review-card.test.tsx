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
  notifications: [] as unknown[],
  turn: 'idle' as string,
  review: undefined as unknown,
  reviewSession: undefined as string | undefined,
}));

vi.mock('@app/features/agent-reviews/views/persisted-review', () => ({
  PersistedReview: (props: {
    sessionId: string;
    reviewId: string;
    canAct: boolean;
    ownerId?: string;
    eventId?: string;
  }) => (
    <section
      aria-label="Saved review"
      data-session={props.sessionId}
      data-review={props.reviewId}
      data-can-act={String(props.canAct)}
      data-owner={props.ownerId ?? ''}
      data-event={props.eventId ?? ''}
    />
  ),
}));
vi.mock('@app/features/agent-reviews/queries/reviews', () => ({
  useReview: (session: () => string) => {
    state.reviewSession = session();
    return state.review;
  },
}));
vi.mock('@app/features/agent-activity/queries/live-session', () => ({
  createLiveSession: () => ({
    metadata: () => ({
      notifications: state.notifications,
      noopTurn: null,
      turn: state.turn,
    }),
    messages: () => [],
  }),
}));
vi.mock('@app/features/block-agent/ui/WorkingLine', () => ({
  WorkingLine: (props: { label: string }) => <p role="status">{props.label}</p>,
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => state.reader,
}));
vi.mock('@core/user', () => ({
  tryMacroId: (id: string) => id,
  getDisplayName: (id: string) =>
    id === MAYA ? 'Maya Chen' : id === LEO ? 'Leo Park' : '',
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
const saved = (actingUser: string | null) => ({
  isPending: false,
  isError: false,
  data: { id: REVIEW, actingUser },
});

beforeEach(() => {
  state.notifications = [];
  state.turn = 'idle';
  state.reader = MAYA;
  state.session = ready({ ownerId: MAYA, canEdit: true, isArchived: false });
  // Saved before reviews named the account they act as: the owner's.
  state.review = saved(null);
  state.reviewSession = undefined;
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
  expect(review.dataset.owner).toBe(MAYA);
});

it('is the saved review of whoever asked, when the agent acted as them', () => {
  // Leo asked in Maya's conversation and the agent drafted from his account.
  state.review = saved(LEO);
  state.reader = LEO;
  expect(card().getByRole('region', { name: 'Saved review' })).toBeTruthy();
  cleanup();
  state.reader = MAYA;
  const owner = card();
  expect(owner.getByText('Waiting for Leo Park')).toBeTruthy();
  expect(owner.queryByRole('region', { name: 'Saved review' })).toBeNull();
});

it("leaves a review that will not load to the owner's card, and names no one to anyone else", () => {
  state.review = { isPending: false, isError: true, data: undefined };
  expect(card().getByRole('region', { name: 'Saved review' })).toBeTruthy();
  cleanup();
  state.reader = LEO;
  const view = card();
  expect(
    view.getByText('Waiting for the person the agent works for')
  ).toBeTruthy();
  expect(view.queryByRole('region', { name: 'Saved review' })).toBeNull();
});

it('follows what the session hears about the review, as the session view does', () => {
  // A decision made elsewhere woke the agent: the card reloads on the event
  // and shows the agent responding until it answers.
  state.notifications = [
    {
      id: 'event-1',
      subjectId: REVIEW,
      turn: 4,
      systemTurn: true,
      createdAt: '2026-10-23T20:00:00Z',
      actionId: 'action-1',
    },
    { id: 'event-0', subjectId: 'another-review', turn: 3, systemTurn: true },
  ];
  state.turn = 'running';
  const view = card();
  expect(view.getByRole('region', { name: 'Saved review' }).dataset.event).toBe(
    'event-1'
  );
  expect(view.getByRole('status').textContent).toBe('Responding');
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

it('tells anyone else in the conversation whose drafts they are, without showing them', () => {
  // Leo asked the agent in Maya's conversation, which acted as Maya.
  state.review = saved(MAYA);
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
  // The review is never asked for by a reader the session turned away.
  expect(state.reviewSession).toBe('');
});

it('loads nothing until both the session and the reader are known', () => {
  state.session = { isPending: true, isError: false, data: undefined };
  const view = card();
  expect(
    view.getByRole('status', { name: 'Loading drafts to review' })
  ).toBeTruthy();
  expect(view.queryByRole('region', { name: 'Saved review' })).toBeNull();
  expect(state.reviewSession).toBe('');
  cleanup();

  state.session = ready({ ownerId: MAYA, canEdit: true, isArchived: false });
  state.review = { isPending: true, isError: false, data: undefined };
  expect(
    card().getByRole('status', { name: 'Loading drafts to review' })
  ).toBeTruthy();
  cleanup();
  state.review = saved(null);

  state.session = ready({ ownerId: MAYA, canEdit: true, isArchived: false });
  state.reader = undefined;
  const unknown = card();
  expect(unknown.queryByRole('region', { name: 'Saved review' })).toBeNull();
  expect(unknown.queryByText(/Waiting for/)).toBeNull();
});
