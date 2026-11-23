import { beforeEach, expect, it, vi } from 'vitest';
import { useSuggestionsFlag } from './use-suggestions-flag';

const mocks = vi.hoisted(() => ({ enabled: true, touch: false }));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: mocks.enabled, loading: false }),
}));
vi.mock('@core/constant/featureFlags', () => ({ enableSuggestions: {} }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => mocks.touch,
}));

beforeEach(() => {
  mocks.enabled = true;
  mocks.touch = false;
});

it('shows suggestions on desktop when the flag is on', () => {
  expect(useSuggestionsFlag()()).toBe(true);
});

it('shows no suggestions on touch devices, even with the flag on', () => {
  mocks.touch = true;

  expect(useSuggestionsFlag()()).toBe(false);
});

it('shows no suggestions while the flag is off', () => {
  mocks.enabled = false;

  expect(useSuggestionsFlag()()).toBe(false);
});
