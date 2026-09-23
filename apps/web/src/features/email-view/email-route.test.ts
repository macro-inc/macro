import { describe, expect, it } from 'vitest';
import { emailTabSearch, emailTabSearchCodec } from './email-route';

describe('Mail tab search', () => {
  it('omits the default tab and round-trips every other tab', () => {
    expect(emailTabSearchCodec.serialize({ tab: 'important' })).toBeUndefined();
    for (const tab of [
      'noise',
      'sent',
      'calendar',
      'drafts',
      'shared',
      'all',
    ] as const) {
      expect(emailTabSearchCodec.serialize({ tab })).toEqual({ tab: [tab] });
      expect(emailTabSearchCodec.parse({ tab: [tab] }).value.tab).toBe(tab);
    }
    expect(emailTabSearch.namespace).toBe('mail');
  });

  it('rejects invalid tabs and restores the default', () => {
    expect(emailTabSearchCodec.parse({ tab: ['unknown'] })).toEqual({
      value: { tab: 'important' },
      valid: false,
    });
  });
});
