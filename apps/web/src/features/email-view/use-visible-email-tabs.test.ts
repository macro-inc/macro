import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { EMAIL_TAB_IDS } from './constants';
import { useVisibleEmailTabIds } from './use-visible-email-tabs';

const flag = vi.hoisted(() => ({ enabled: true }));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({
    enabled: flag.enabled,
    loading: false,
    payload: undefined,
  }),
}));

describe('visible email tabs', () => {
  it('offers Reminders as an Email tab while the flag is on', () => {
    flag.enabled = true;
    createRoot((dispose) => {
      expect(useVisibleEmailTabIds()()).toEqual(EMAIL_TAB_IDS);
      expect(useVisibleEmailTabIds()()).toContain('reminders');
      dispose();
    });
  });

  it('drops Reminders from every tab surface while the flag is off', () => {
    flag.enabled = false;
    createRoot((dispose) => {
      const ids = useVisibleEmailTabIds()();
      expect(ids).not.toContain('reminders');
      expect(ids).toEqual(EMAIL_TAB_IDS.filter((id) => id !== 'reminders'));
      dispose();
    });
  });
});
