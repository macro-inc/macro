import { describe, expect, it, vi } from 'vitest';

vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_NEW_INBOX: () => false,
  ENABLE_SNIPPETS: () => true,
  ENABLE_SUPPORTED_SOUP_FOREIGN_ENTITIES_OVERRIDE: false,
}));

import { getViewPreset, VIEW_TAB_PRESETS } from './soup-filter-presets';

const mailTabs = Object.keys(VIEW_TAB_PRESETS.mail.tabs);

describe('mail view presets', () => {
  it('groups every mail tab by date independently of the new inbox flag', () => {
    for (const tab of mailTabs) {
      expect(getViewPreset('mail', tab)?.groupBy).toBe('date');
    }
  });
});
