import type { PrPageActions } from '../context/pr-page-actions';
import type { PrActions } from './create-pr-actions';

/** Offer only real lifecycle mutations; unavailable capabilities have no write function. */
export function createPrPageActions(
  lifecycle: Pick<PrActions, 'all' | 'pending'>
): PrPageActions {
  const unavailable = { available: () => false };
  return {
    changeState: {
      available: () => lifecycle.all().some((action) => !action.disabledReason),
      availableFor: (key) =>
        lifecycle
          .all()
          .some((action) => action.key === key && !action.disabledReason),
      run: (key) => {
        if (lifecycle.pending()) return;
        const action = lifecycle.all().find((item) => item.key === key);
        if (!action || action.disabledReason) return;
        action.run();
      },
    },
    pending: lifecycle.pending,
    mergeWhenReady: unavailable,
    rerunChecks: unavailable,
    comment: unavailable,
    reply: unavailable,
    addToReview: unavailable,
    submitReview: unavailable,
    resolveThread: unavailable,
    commitSuggestion: unavailable,
    markViewed: unavailable,
    linkTask: unavailable,
  };
}
