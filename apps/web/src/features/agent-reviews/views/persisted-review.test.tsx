/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, type Mock, vi } from 'vitest';
import type { Review, ReviewActions } from '../core/review';
import { PersistedReview } from './persisted-review';

const reviews = vi.hoisted(() => {
  const state: {
    record: Review | undefined;
    decide: Mock<ReviewActions['decide']>;
  } = { record: undefined, decide: vi.fn() };
  return state;
});
vi.mock('../queries/reviews', () => ({
  useReview: () => ({
    isError: false,
    isSuccess: true,
    data: reviews.record,
    refetch: vi.fn(),
  }),
  useReviewActions: () => ({ reload: vi.fn(), decide: reviews.decide }),
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|owner@macro.local',
}));
function Card(props: { review: Review; actions: ReviewActions }) {
  return (
    <>
      <button
        type="button"
        onClick={() =>
          props.actions.decide({
            action: 'submit',
            revision: props.review.revision,
            items: [],
          })
        }
      >
        Approve
      </button>
      <button
        type="button"
        onClick={() =>
          props.actions.decide({
            action: 'dismiss',
            revision: props.review.revision,
            items: [],
          })
        }
      >
        Dismiss
      </button>
    </>
  );
}
vi.mock('./import-review', () => ({
  ImportReview: (props: { review: Review; actions: ReviewActions }) =>
    Card(props),
}));
vi.mock('./review-stack', () => ({
  ReviewStack: (props: { review: Review; actions: ReviewActions }) =>
    Card(props),
}));

const importReview: Review = {
  id: 'review',
  sessionId: 'session',
  actingUser: 'macro|owner@macro.local',
  executionId: null,
  kind: 'import',
  title: 'Review',
  revision: 1,
  updatedAt: 1,
  presentedAt: 1,
  decision: null,
  items: [
    {
      id: 'item',
      draft: { source: 'notion' },
      status: 'pending',
      error: null,
      result: null,
    },
  ],
};
const emailReview: Review = {
  id: 'review',
  sessionId: 'session',
  actingUser: 'macro|owner@macro.local',
  executionId: null,
  kind: 'email',
  title: 'Review',
  revision: 1,
  updatedAt: 1,
  presentedAt: 1,
  decision: null,
  items: [
    {
      id: 'item',
      draft: { subject: 'Hello', body: '', to: [{ email: 'a@example.com' }] },
      status: 'pending',
      error: null,
      result: null,
    },
  ],
};

afterEach(() => {
  cleanup();
  reviews.decide.mockReset();
});

describe('PersistedReview', () => {
  it('expects no answer until an approved import settles', () => {
    reviews.record = importReview;
    reviews.decide.mockResolvedValue(importReview);
    const onDecision = vi.fn();
    render(() => (
      <PersistedReview
        sessionId="session"
        reviewId="review"
        canAct
        onDecision={onDecision}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(reviews.decide).toHaveBeenCalledTimes(1);
    expect(onDecision).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDecision).toHaveBeenCalledTimes(1);
  });

  it('expects the agent to answer an approved email stack at once', () => {
    reviews.record = emailReview;
    reviews.decide.mockResolvedValue(emailReview);
    const onDecision = vi.fn();
    render(() => (
      <PersistedReview
        sessionId="session"
        reviewId="review"
        canAct
        onDecision={onDecision}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onDecision).toHaveBeenCalledTimes(1);
  });
});
