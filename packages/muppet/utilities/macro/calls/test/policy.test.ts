import { describe, expect, test } from 'bun:test';
import { privateAddress, safeUrl, urlRule } from '../policy.ts';

describe('urlRule', () => {
  test('allows ordinary public pages, and a blank tab', () => {
    expect(urlRule('https://example.com/docs#intro')).toEqual({
      ok: true,
      host: 'example.com',
      url: 'https://example.com/docs#intro',
    });
    expect(urlRule('about:blank').ok).toBe(true);
  });

  test.each([
    ['https://mail.google.com/', 'mail'],
    ['https://vault.bitwarden.com/', 'password-manager'],
    ['https://dashboard.stripe.com/', 'billing'],
    ['https://example.com/settings/tokens', 'account-security'],
    ['https://example.com/#/billing', 'billing'],
    ['http://127.0.0.1:3000/', 'private-host'],
    ['http://2130706433/', 'private-host'],
    ['http://[::1]/', 'private-host'],
    ['http://intranet.local/', 'private-host'],
    ['file:///etc/passwd', 'scheme'],
    ['https://user:pass@example.com/', 'credentials'],
    ['not a url', 'invalid-url'],
  ])('refuses %s (%s)', (url, rule) => {
    expect(urlRule(url)).toEqual({ ok: false, rule });
  });

  test('takes other blocklists', () => {
    expect(
      urlRule('https://example.com/', {
        hosts: [['example', /^example\.com$/]],
      })
    ).toEqual({ ok: false, rule: 'example' });
  });
});

describe('privateAddress', () => {
  test.each([
    ['10.0.0.1', true],
    ['100.100.1.1', true],
    ['::ffff:192.168.1.1', true],
    ['fd00::1', true],
    ['93.184.216.34', false],
    ['2606:2800:220:1::1', false],
  ])('%s is private: %p', (address, expected) => {
    expect(privateAddress(address)).toBe(expected);
  });
});

describe('safeUrl', () => {
  test('refuses a name that resolves to this machine', async () => {
    expect(await safeUrl('http://localhost.example.invalid/')).toBe(false);
    expect(await safeUrl('about:blank')).toBe(true);
  });
});
