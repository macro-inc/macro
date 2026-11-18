import type {
  ReviewDecision_Deserialize,
  ReviewDraft_Deserialize,
  ReviewRecord_Serialize,
} from '@service-agent-reviews/generated/types';

/** A saved interaction is independent from the code run that prepared it. */
export type Review = ReviewRecord_Serialize;
export type ReviewItem = Review['items'][number];
/** A replacement draft, keyed by its review's kind. */
export type ReviewDraft = ReviewDraft_Deserialize;
export type ReviewDecision = ReviewDecision_Deserialize;
export type ReviewActions = {
  reload: () => Promise<Review>;
  decide: (decision: ReviewDecision) => Promise<Review>;
};

/**
 * Whether the agent answers a decision as soon as it is made. Approving an
 * import only starts its write; the agent answers when the write settles.
 */
export function decisionWakesAgent(
  kind: Review['kind'],
  decision: ReviewDecision
): boolean {
  if (decision.action === 'edit') return false;
  return !(kind === 'import' && decision.action === 'submit');
}
