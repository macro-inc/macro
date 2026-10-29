/** Isolate response timing from the email/calendar editors and network writes. */
export function PersistedReview(props: {
  onDecision?: () => void;
  onDecisionFailed?: () => void;
}) {
  return (
    <section class="review-card">
      <h2>Review drafts</h2>
      <p>One saved draft awaiting the owner's decision.</p>
      <button type="button" onClick={() => props.onDecision?.()}>
        Decide
      </button>
      <button type="button" onClick={() => props.onDecisionFailed?.()}>
        Reject request
      </button>
    </section>
  );
}
