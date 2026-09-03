import { describe, expect, it, vi } from 'vitest';

const featureFlag = vi.hoisted(() => ({
  enabled: false,
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({
    enabled: featureFlag.enabled,
    loading: false,
  }),
}));

import { useCursorAgentsAccess } from './flag';

describe('useCursorAgentsAccess', () => {
  it('follows the Cursor rollout flag', () => {
    const canUseCursor = useCursorAgentsAccess();

    expect(canUseCursor()).toBe(false);
    featureFlag.enabled = true;
    expect(canUseCursor()).toBe(true);
  });
});
