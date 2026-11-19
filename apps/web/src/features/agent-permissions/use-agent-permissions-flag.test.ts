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
  it('is off with only the permissions flag', () => {
    expect(shown('enable-agent-permissions')).toBe(false);
  });

  it('is off without the permissions flag', () => {
    expect(shown('enable-ocaml-code-mode', 'enable-js-tools-code-mode')).toBe(
      false
    );
  });

  it('is on with the permissions flag and either checked language', () => {
    expect(shown('enable-agent-permissions', 'enable-ocaml-code-mode')).toBe(
      true
    );
    expect(shown('enable-agent-permissions', 'enable-js-tools-code-mode')).toBe(
      true
    );
  });
});
