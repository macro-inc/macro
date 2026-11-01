import { describe, expect, it, vi } from 'vitest';

vi.mock('@queries/email/message-source', () => ({
  getEmailMessageEml: vi.fn(),
}));

import { emlFilename } from './eml-download-adapter';

describe('emlFilename', () => {
  it('matches the server name for a subject', () => {
    expect(emlFilename('Re: Q3 plan')).toBe('Re Q3 plan.eml');
    expect(emlFilename('a/b\\c\r\n"d"')).toBe('a b c d.eml');
  });
  it('falls back to "email" for an empty subject', () => {
    expect(emlFilename(undefined)).toBe('email.eml');
    expect(emlFilename('  ')).toBe('email.eml');
    expect(emlFilename('...')).toBe('email.eml');
  });
  it('bounds long subjects', () => {
    expect(emlFilename('x'.repeat(300))).toHaveLength(124);
  });
});
