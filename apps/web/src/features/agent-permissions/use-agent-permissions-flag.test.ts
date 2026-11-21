import type { RemoteFlag } from '@core/constant/featureFlags';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentPermissionsFlag } from './use-agent-permissions-flag';

// The flags each test turns on, by PostHog key.
const on = vi.hoisted(() => new Set<string>());
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: (flag: RemoteFlag) => () => ({
    enabled: on.has(flag.key),
    loading: false,
  }),
}));

function shown(...flags: string[]) {
  on.clear();
  for (const flag of flags) on.add(flag);
  return createRoot((dispose) => {
    const value = useAgentPermissionsFlag()();
    dispose();
    return value;
  });
}

beforeEach(() => on.clear());

describe('useAgentPermissionsFlag', () => {
  it('is on with the permissions flag alone', () => {
    expect(shown('enable-agent-permissions')).toBe(true);
  });

  it('is off without the permissions flag, whatever else is on', () => {
    expect(shown()).toBe(false);
    expect(shown('enable-something-else')).toBe(false);
  });
});
