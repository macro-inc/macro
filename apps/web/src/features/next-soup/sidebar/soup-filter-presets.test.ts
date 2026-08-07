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

describe('calendar event scoping', () => {
  it('excludes calendar events from views that do not render them', () => {
    const nilId = '00000000-0000-0000-0000-000000000000';

    expect(
      getViewPreset('mail', 'important')?.filters.include?.calendarEventId
    ).toEqual([nilId]);
    expect(
      getViewPreset('inbox', 'all')?.filters.include?.calendarEventId
    ).toEqual([nilId]);
    expect(
      getViewPreset('search', 'all')?.filters.include?.calendarEventId
    ).toEqual([nilId]);
  });
});
