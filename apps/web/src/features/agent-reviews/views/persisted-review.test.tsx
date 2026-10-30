/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Review, ReviewActions } from '../core/review';
import { PersistedReview } from './persisted-review';

const reviews = vi.hoisted(() => ({
  record: undefined as Review | undefined,
  decide: vi.fn(),
}));
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

function review(kind: Review['kind']): Review {
  return {
    id: 'review',
    sessionId: 'session',
    kind,
    title: 'Review',
    revision: 1,
    updatedAt: 1,
    presentedAt: 1,
    items: [{ id: 'item', draft: {}, status: 'pending' }],
  };
}

afterEach(() => {
  cleanup();
  reviews.decide.mockReset();
});

describe('PersistedReview', () => {
  it('expects no answer until an approved import settles', () => {
    reviews.record = review('import');
    reviews.decide.mockResolvedValue(review('import'));
    const onDecision = vi.fn();
    render(() => (
      <PersistedReview
        sessionId="session"
        reviewId="review"
        canAct
        ownerId="macro|owner@macro.local"
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
    reviews.record = review('email');
    reviews.decide.mockResolvedValue(review('email'));
    const onDecision = vi.fn();
    render(() => (
      <PersistedReview
        sessionId="session"
        reviewId="review"
        canAct
        ownerId="macro|owner@macro.local"
        onDecision={onDecision}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onDecision).toHaveBeenCalledTimes(1);
  });
});
