import { describe, expect, it, vi } from 'vitest';
import { isSpreadsheetEnabledForCurrentUser } from './spreadsheet-access';

const state = vi.hoisted(() => ({
  enabled: true,
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableSpreadsheets: {},
  isFeatureEnabled: () => state.enabled,
}));
describe('imperative spreadsheet rollout guard', () => {
  it('follows the PostHog decision without a separate email restriction', () => {
    expect(isSpreadsheetEnabledForCurrentUser()).toBe(true);
    state.enabled = false;
    expect(isSpreadsheetEnabledForCurrentUser()).toBe(false);
  });
});
