import type { InviteOfferSlot } from '../views/plan-step';

/** Stands in for the gtm-invite panel, which needs the app's analytics and queries. */
export const renderInviteOfferStub: InviteOfferSlot = (offer, actions) => (
  <section aria-label="Invite offer">
    <h1>
      Your first {offer.freeMonths} months are free, {offer.firstName}.
    </h1>
    <button
      type="button"
      disabled={actions.finishing()}
      onClick={actions.onClaim}
    >
      Claim your free months
    </button>
    <button type="button" onClick={actions.onContinueFree}>
      Continue with Free instead
    </button>
  </section>
);
