import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mobile: false,
  flags: {} as Record<string, boolean>,
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag:
    (key: string, opts?: { enabledOverride?: boolean }) => () => ({
      enabled: opts?.enabledOverride ?? mocks.flags[key] ?? false,
    }),
}));

vi.mock('@core/mobile/isMobile', () => ({
  isMobile: () => mocks.mobile,
}));

vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_CALENDAR_UI_FLAG: 'enable-calendar-ui',
  ENABLE_CALENDAR_UI_OVERRIDE: undefined,
  ENABLE_CALENDAR_PROMPT_MOBILE_FLAG: 'enable-calendar-prompt-mobile',
  ENABLE_CALENDAR_PROMPT_MOBILE_OVERRIDE: undefined,
}));

import { useCalendarPromptAllowed } from './use-calendar-ui-flag';

describe('useCalendarPromptAllowed', () => {
  function allowed(state: { mobile: boolean; mobileFlag?: boolean }): boolean {
    mocks.mobile = state.mobile;
    mocks.flags = { 'enable-calendar-prompt-mobile': !!state.mobileFlag };
    return useCalendarPromptAllowed()();
  }

  it('allows the prompt on desktop regardless of the mobile flag', () => {
    expect(allowed({ mobile: false })).toBe(true);
    expect(allowed({ mobile: false, mobileFlag: true })).toBe(true);
  });

  it('suppresses the prompt on mobile while the flag is off', () => {
    expect(allowed({ mobile: true })).toBe(false);
  });

  it('allows the prompt on mobile once the flag is turned on', () => {
    expect(allowed({ mobile: true, mobileFlag: true })).toBe(true);
  });
});
