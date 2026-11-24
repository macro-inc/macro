import { describe, expect, it } from 'vitest';
import { detectInAppBrowser, systemBrowserUrl } from './in-app-browser';

const IOS_INSTAGRAM =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 355.0.0.21.108 (iPhone15,2; iOS 18_1; en_US; en; scale=3.00; 1179x2556; 652452452)';
const ANDROID_INSTAGRAM =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.6613.127 Mobile Safari/537.36 Instagram 348.0.0.40.109 Android (34/14; 420dpi; 1080x2400; Google/google; Pixel 8; shiba; shiba; en_US; 637184620)';
const IOS_FACEBOOK =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.37.103;FBBV/612345678;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]';
const ANDROID_FACEBOOK =
  'Mozilla/5.0 (Linux; Android 13; SM-S911B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0.6533.103 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/475.0.0.43.109;]';
const IOS_THREADS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Barcelona 351.0.0.25.87 (iPhone16,1; iOS 18_0; en_US; en; scale=3.00; 1179x2556; 652452452)';
const IOS_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
const IPADOS_INSTAGRAM =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Instagram 355.0.0.21.108';

describe('detectInAppBrowser', () => {
  it.each([
    [IOS_INSTAGRAM, 5, { app: 'instagram', platform: 'ios' }],
    [ANDROID_INSTAGRAM, 5, { app: 'instagram', platform: 'android' }],
    [IOS_FACEBOOK, 5, { app: 'facebook', platform: 'ios' }],
    [ANDROID_FACEBOOK, 5, { app: 'facebook', platform: 'android' }],
    [IOS_THREADS, 5, { app: 'threads', platform: 'ios' }],
    [IPADOS_INSTAGRAM, 5, { app: 'instagram', platform: 'ios' }],
    [IPADOS_INSTAGRAM, 0, { app: 'instagram', platform: 'unknown' }],
  ])('recognizes %s', (userAgent, touchPoints, expected) => {
    expect(detectInAppBrowser(userAgent, touchPoints)).toEqual(expected);
  });

  it.each([IOS_SAFARI, ANDROID_CHROME])(
    'leaves ordinary browsers alone: %s',
    (userAgent) => {
      expect(detectInAppBrowser(userAgent, 5)).toBeUndefined();
    }
  );
});

describe('systemBrowserUrl', () => {
  const url = 'https://macro.com/app/signup?utm_source=ig&fbclid=abc';

  it('asks iOS to open Safari', () => {
    expect(systemBrowserUrl(url, 'ios')).toBe(
      'x-safari-https://macro.com/app/signup?utm_source=ig&fbclid=abc'
    );
  });

  it('asks Android for the default browser, keeping the query', () => {
    expect(systemBrowserUrl(url, 'android')).toBe(
      'intent://macro.com/app/signup?utm_source=ig&fbclid=abc#Intent;scheme=https;action=android.intent.action.VIEW;' +
        `S.browser_fallback_url=${encodeURIComponent(url)};end`
    );
  });
});
