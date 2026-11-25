import { describe, expect, test } from 'bun:test';
import { detect, solvePageUrl } from '../detect.ts';

describe('detect', () => {
  test('a Turnstile widget, with its action, cdata and callback', () => {
    expect(
      detect({
        url: 'https://shop.example/login?next=%2Fcart',
        title: 'Sign in',
        widgets: [
          {
            className: 'cf-turnstile',
            siteKey: '0x4AAAAAAAexampleKey',
            action: 'login',
            cdata: 'session-42',
            callback: 'onTurnstile',
          },
        ],
        frames: ['https://shop.example/login?next=%2Fcart'],
        scripts: ['https://challenges.cloudflare.com/turnstile/v0/api.js'],
        markers: [],
      })
    ).toEqual({
      kind: 'supported',
      challenge: {
        kind: 'turnstile',
        siteKey: '0x4AAAAAAAexampleKey',
        action: 'login',
        cdata: 'session-42',
      },
      callback: 'onTurnstile',
    });
  });

  test('a reCAPTCHA v2 checkbox, enterprise when enterprise.js is loaded', () => {
    expect(
      detect({
        url: 'https://forms.example/contact',
        title: 'Contact',
        widgets: [
          {
            className: 'g-recaptcha form-row',
            siteKey: '6LcExampleSiteKey',
            dataS: 'opaque-s',
          },
        ],
        frames: [],
        scripts: ['https://www.google.com/recaptcha/enterprise.js'],
        markers: [],
      })
    ).toEqual({
      kind: 'supported',
      challenge: {
        kind: 'recaptchaV2',
        siteKey: '6LcExampleSiteKey',
        invisible: false,
        enterprise: true,
        dataS: 'opaque-s',
      },
    });
  });

  test('an invisible reCAPTCHA v2 found only by its anchor frame', () => {
    expect(
      detect({
        url: 'https://forms.example/contact',
        title: 'Contact',
        widgets: [],
        frames: [
          'https://forms.example/contact',
          'https://www.google.com/recaptcha/api2/anchor?ar=1&k=6LcAnchorKey&size=invisible',
        ],
        scripts: [],
        markers: [],
      })
    ).toEqual({
      kind: 'supported',
      challenge: {
        kind: 'recaptchaV2',
        siteKey: '6LcAnchorKey',
        invisible: true,
        enterprise: false,
      },
    });
  });

  test('a Turnstile frame carries its site key in its path', () => {
    expect(
      detect({
        url: 'https://shop.example/',
        title: 'Shop',
        widgets: [],
        frames: [
          'https://shop.example/',
          'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2/av0/rcv/abc/0x4AAAAAAAframeKey/auto/fbE/new/normal',
        ],
        scripts: [],
        markers: [],
      })
    ).toEqual({
      kind: 'supported',
      challenge: { kind: 'turnstile', siteKey: '0x4AAAAAAAframeKey' },
    });
  });

  test('reCAPTCHA v3: api.js?render=<key> and no widget', () => {
    expect(
      detect({
        url: 'https://app.example/signup',
        title: 'Sign up',
        widgets: [],
        frames: [],
        scripts: ['https://www.google.com/recaptcha/api.js?render=6LcV3Key'],
        markers: [],
      })
    ).toEqual({
      kind: 'supported',
      challenge: {
        kind: 'recaptchaV3',
        siteKey: '6LcV3Key',
        enterprise: false,
      },
    });
  });

  test('api.js?render=explicit is no v3 site key', () => {
    expect(
      detect({
        url: 'https://app.example/',
        title: 'App',
        widgets: [],
        frames: [],
        scripts: ['https://www.google.com/recaptcha/api.js?render=explicit'],
        markers: [],
      })
    ).toEqual({ kind: 'none' });
  });

  test("Cloudflare's interstitial is unsupported, though Turnstile runs inside it", () => {
    expect(
      detect({
        url: 'https://shop.example/?__cf_chl_rt_tk=abc',
        title: 'Just a moment...',
        widgets: [],
        frames: [
          'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/g/turnstile/if/ov2/av0/rcv/x/0x4AAAAAAAinsideKey/auto/n/normal',
        ],
        scripts: [],
        markers: ['challenge-form'],
      })
    ).toEqual({ kind: 'unsupported', provider: 'cloudflareChallenge' });
  });

  test('hCaptcha and DataDome are unsupported', () => {
    expect(
      detect({
        url: 'https://site.example/',
        title: 'Site',
        widgets: [
          {
            className: 'h-captcha',
            siteKey: '10000000-ffff-ffff-ffff-000000000001',
          },
        ],
        frames: [
          'https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html',
        ],
        scripts: ['https://js.hcaptcha.com/1/api.js'],
        markers: ['h-captcha'],
      })
    ).toEqual({ kind: 'unsupported', provider: 'hcaptcha' });
    expect(
      detect({
        url: 'https://site.example/',
        title: 'Site',
        widgets: [],
        frames: ['https://geo.captcha-delivery.com/captcha/?initialCid=abc'],
        scripts: [],
        markers: [],
      })
    ).toEqual({ kind: 'unsupported', provider: 'datadome' });
  });

  test('a plain page shows no check', () => {
    expect(
      detect({
        url: 'https://docs.example/guide',
        title: 'Guide',
        widgets: [],
        frames: ['https://docs.example/guide'],
        scripts: ['https://docs.example/app.js'],
        markers: [],
      })
    ).toEqual({ kind: 'none' });
  });

  test('a look-alike host is not reCAPTCHA', () => {
    expect(
      detect({
        url: 'https://evil.example/',
        title: 'x',
        widgets: [],
        frames: [
          'https://www.google.com.evil.example/recaptcha/api2/anchor?k=6LcFake',
        ],
        scripts: [],
        markers: [],
      })
    ).toEqual({ kind: 'none' });
  });
});

describe('solvePageUrl', () => {
  test('keeps the origin and path, never the query or fragment', () => {
    expect(solvePageUrl('https://shop.example/login?token=secret#frag')).toBe(
      'https://shop.example/login'
    );
  });

  test('only web pages', () => {
    expect(solvePageUrl('file:///home/macro/page.html')).toBeUndefined();
    expect(solvePageUrl('chrome://settings')).toBeUndefined();
  });
});
