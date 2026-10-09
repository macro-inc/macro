import { describe, expect, it } from 'vitest';
import {
  acceptsWorkspaceMx,
  isGoogleWorkspaceMxHost,
  isPersonalEmailDomain,
  primaryMxHost,
} from './google-workspace-email';

describe('google workspace work email', () => {
  it('refuses personal providers', () => {
    expect(isPersonalEmailDomain('ada@gmail.com')).toBe(true);
    expect(isPersonalEmailDomain('Ada@Yahoo.com')).toBe(true);
    expect(isPersonalEmailDomain('ada@acme.com')).toBe(false);
  });

  it('uses the lowest-preference MX host', () => {
    expect(
      primaryMxHost([
        '10 alt1.aspmx.l.google.com.',
        '1 aspmx.l.google.com.',
        '5 alt2.aspmx.l.google.com.',
      ])
    ).toBe('aspmx.l.google.com');
  });

  it('accepts a workspace exchanger and refuses consumer gmail', () => {
    expect(isGoogleWorkspaceMxHost('aspmx.l.google.com.')).toBe(true);
    expect(isGoogleWorkspaceMxHost('smtp.google.com')).toBe(true);
    expect(isGoogleWorkspaceMxHost('gmail-smtp-in.l.google.com')).toBe(false);
    expect(
      acceptsWorkspaceMx({
        Status: 0,
        Answer: [{ type: 15, data: '1 aspmx.l.google.com.' }],
      })
    ).toBe(true);
    expect(
      acceptsWorkspaceMx({
        Status: 0,
        Answer: [{ type: 15, data: '5 gmail-smtp-in.l.google.com.' }],
      })
    ).toBe(false);
  });
});
