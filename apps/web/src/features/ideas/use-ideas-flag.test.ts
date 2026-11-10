import { beforeEach, expect, it, vi } from 'vitest';
import { useIdeasFlag } from './use-ideas-flag';

const mocks = vi.hoisted(() => ({ enabled: true, touch: false }));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: mocks.enabled, loading: false }),
}));
vi.mock('@core/constant/featureFlags', () => ({ enableIdeas: {} }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => mocks.touch,
}));

beforeEach(() => {
  mocks.enabled = true;
  mocks.touch = false;
});

it('shows ideas on desktop when the flag is on', () => {
  expect(useIdeasFlag()()).toBe(true);
});

it('shows no ideas on touch devices, even with the flag on', () => {
  mocks.touch = true;

  expect(useIdeasFlag()()).toBe(false);
});

it('shows no ideas while the flag is off', () => {
  mocks.enabled = false;

  expect(useIdeasFlag()()).toBe(false);
});
