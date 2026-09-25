import { describe, expect, it } from 'vitest';
import { EMAIL_TAB_IDS } from './constants';
import { emailTabSearchCodec } from './email-route';

describe('email tab search params', () => {
  it.each(EMAIL_TAB_IDS)('keeps the %s tab through the URL', (tab) => {
    const params = emailTabSearchCodec.serialize({ tab });
    expect(emailTabSearchCodec.parse(params)).toEqual({
      value: { tab },
      valid: true,
    });
  });
});
