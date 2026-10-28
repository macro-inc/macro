import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { useSpreadsheetAccess } from './use-spreadsheet-access';

const state = vi.hoisted(() => ({
  flag: (): boolean => false,
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: state.flag() }),
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableSpreadsheets: { key: 'enable-spreadsheets' },
}));
describe('spreadsheet internal rollout', () => {
  it('reacts to the PostHog rollout decision', () => {
    createRoot((dispose) => {
      const [flag, setFlag] = createSignal(false);
      state.flag = flag;
      const access = useSpreadsheetAccess();
      expect(access()).toBe(false);
      setFlag(true);
      expect(access()).toBe(true);
      setFlag(false);
      expect(access()).toBe(false);
      dispose();
    });
  });
});
