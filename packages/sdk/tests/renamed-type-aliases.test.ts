import { expect, test } from 'bun:test';
import type * as reviews from '../src/compat/agent-reviews';
import type * as cognition from '../src/compat/cognition';

/** True only when `A` and `B` are the same type. */
type Same<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

// Published type names stay importable after the API renamed them, as the
// same types, until callers move to the new names.
test('the HubSpot report types keep their old names as aliases', () => {
  const kept: [
    Same<cognition.HubspotReport, cognition.CrmReport>,
    Same<cognition.HubspotLoss, cognition.CrmLoss>,
    Same<cognition.HubspotLossCount, cognition.CrmLossCount>,
    Same<reviews.HubspotReport, reviews.CrmReport>,
    Same<reviews.HubspotLoss, reviews.CrmLoss>,
    Same<reviews.HubspotLossCount, reviews.CrmLossCount>,
  ] = [true, true, true, true, true, true];
  expect(kept.every(Boolean)).toBe(true);
});
