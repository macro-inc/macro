import { expect, test } from 'bun:test';
import {
  driveRule,
  privateAddress,
  safeUrl,
  startRule,
  urlRule,
} from '../share-policy.ts';

const blocked: readonly (readonly [url: string, rule: string])[] = [
  ['https://mail.google.com/', 'mail'],
  ['https://gmail.com/', 'mail'],
  ['https://webmail.example.org/', 'mail'],
  ['https://outlook.live.com/mail/', 'mail'],
  ['https://proton.me/', 'mail'],
  ['https://fastmail.com/', 'mail'],
  ['https://mail.yahoo.com/', 'mail'],
  ['https://agentmail.to/', 'mail'],
  ['https://doppler.com/', 'doppler'],
  ['https://1password.com/', 'password-manager'],
  ['https://bitwarden.com/', 'password-manager'],
  ['https://lastpass.com/', 'password-manager'],
  ['https://dashlane.com/', 'password-manager'],
  ['https://keepersecurity.com/', 'password-manager'],
  ['https://dashboard.stripe.com/', 'billing'],
  ['https://console.aws.amazon.com/billing/', 'billing'],
  ['https://console.cloud.google.com/billing', 'billing'],
  ['https://example.com/invoices/123', 'billing'],
  ['https://example.com/payment', 'billing'],
  ['https://example.com/checkout', 'billing'],
  // A single-page app's route lives in the hash.
  ['https://example.com/app#/billing', 'billing'],
  ['https://example.com/%62illing', 'billing'],
  ['https://accounts.google.com/', 'account-security'],
  ['https://myaccount.google.com/', 'account-security'],
  ['https://id.atlassian.com/', 'account-security'],
  ['https://example.com/settings/tokens', 'account-security'],
  ['https://example.com/settings/keys', 'account-security'],
  ['https://example.com/api-keys', 'account-security'],
  ['https://example.com/secrets', 'account-security'],
  ['file:///etc/passwd', 'scheme'],
  ['chrome://settings', 'scheme'],
  ['devtools://x', 'scheme'],
  ['view-source:https://example.com', 'scheme'],
  ['data:text/html,hello', 'scheme'],
  ['https://user:pass@example.com/', 'credentials'],
  ['http://127.0.0.1/', 'private-host'],
  ['http://2130706433/', 'private-host'],
  ['http://0x7f000001/', 'private-host'],
  ['http://0177.0.0.1/', 'private-host'],
  ['http://127.1/', 'private-host'],
  ['http://localhost./', 'private-host'],
  ['http://192.168.1.1/', 'private-host'],
  ['http://10.1.2.3/', 'private-host'],
  ['http://172.16.0.1/', 'private-host'],
  ['http://169.254.169.254/', 'private-host'],
  ['http://[::1]/', 'private-host'],
  ['http://metadata.google.internal/', 'private-host'],
  ['not a url', 'invalid-url'],
];
for (const [url, rule] of blocked)
  test(`share policy blocks ${url}`, () =>
    expect(urlRule(url)).toEqual({ ok: false, rule }));

test("a public page is shown by its host, and a new tab's blank page is allowed", () => {
  expect(urlRule('https://Example.com/docs?secret=1')).toEqual({
    ok: true,
    host: 'example.com',
    url: 'https://example.com/docs?secret=1',
  });
  expect(urlRule('about:blank')).toMatchObject({ ok: true, host: 'blank' });
});

test('a share may start when invited, and never uninvited', () => {
  const base = { url: 'https://example.com/', active: false, uninvited: false };
  expect(startRule(base)).toEqual({
    ok: true,
    host: 'example.com',
    url: 'https://example.com/',
  });
  expect(startRule({ ...base, uninvited: true })).toEqual({
    ok: false,
    rule: 'uninvited',
  });
});

test('the blocklist has no override', () => {
  expect(
    startRule({
      url: 'https://mail.google.com/',
      active: false,
      uninvited: false,
    })
  ).toEqual({ ok: false, rule: 'mail' });
});

test('one share at a time, and nothing to drive without one', () => {
  expect(
    startRule({
      url: 'https://example.com/',
      active: true,
      uninvited: false,
    })
  ).toEqual({ ok: false, rule: 'already-sharing' });
  expect(driveRule(false)).toEqual({ ok: false, rule: 'no-share' });
  expect(driveRule(true)).toEqual({ ok: true });
});

test('a public AAAA record is fine; private addresses in any form are not', () => {
  for (const ip of [
    '2606:4700::6810:84e5',
    '93.184.216.34',
    '::ffff:93.184.216.34',
  ])
    expect(privateAddress(ip)).toBe(false);
  for (const ip of [
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    'fc00::1',
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '100.64.0.1',
  ])
    expect(privateAddress(ip)).toBe(true);
});

test("a public name that resolves to this machine is refused, as is one that doesn't resolve", async () => {
  const names: Readonly<Record<string, readonly string[]>> = {
    'example.com': ['93.184.216.34', '2606:4700::6810:84e5'],
    'rebind.example': ['93.184.216.34', '127.0.0.1'],
    'nowhere.example': [],
  };
  const asked: string[] = [];
  const safe = safeUrl(async (host) => {
    asked.push(host);
    const addresses = names[host];
    if (addresses === undefined) throw new Error('ENOTFOUND');
    return addresses;
  });
  expect(await safe('https://example.com/')).toBe(true);
  expect(await safe('https://rebind.example/')).toBe(false);
  expect(await safe('https://nowhere.example/')).toBe(false);
  expect(await safe('https://unknown.example/')).toBe(false);
  // Refused by rule before anything is resolved, and a blank tab has no name to resolve.
  asked.length = 0;
  expect(await safe('https://mail.google.com/')).toBe(false);
  expect(await safe('about:blank')).toBe(true);
  expect(asked).toEqual([]);
});
