import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LANDING_REFERRER_KEY,
  rememberLandingReferrer,
  restoreInitialReferrer,
} from './landingReferrer';

const referrer = (value: string) => {
  vi.spyOn(document, 'referrer', 'get').mockReturnValue(value);
};

describe('landing referrer', () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('stores the external referrer before the signup redirect', () => {
    referrer('https://instagram.com/');
    rememberLandingReferrer();
    expect(sessionStorage.getItem(LANDING_REFERRER_KEY)).toBe(
      'https://instagram.com/'
    );
  });

  it('drops a saved referrer when signup is a direct visit', () => {
    sessionStorage.setItem(LANDING_REFERRER_KEY, 'https://instagram.com/');
    referrer('');
    rememberLandingReferrer();
    expect(sessionStorage.getItem(LANDING_REFERRER_KEY)).toBeNull();
  });

  it('does not replace the stored referrer with the macro.com hop', () => {
    sessionStorage.setItem(LANDING_REFERRER_KEY, 'https://l.instagram.com/');
    referrer(`${window.location.origin}/?utm_source=ig&utm_medium=cpc`);
    rememberLandingReferrer();
    expect(sessionStorage.getItem(LANDING_REFERRER_KEY)).toBe(
      'https://l.instagram.com/'
    );
  });

  it('restores $initial_referrer when the signup pageview would record the hop', () => {
    sessionStorage.setItem(LANDING_REFERRER_KEY, 'https://instagram.com/');
    const hop = `${window.location.origin}/?utm_source=ig&utm_medium=cpc`;
    const event = {
      $set_once: {
        $initial_referrer: hop,
        $initial_referring_domain: window.location.hostname,
        $initial_utm_source: 'ig',
      },
    };
    restoreInitialReferrer(event);
    expect(event.$set_once).toEqual({
      $initial_referrer: 'https://instagram.com/',
      $initial_referring_domain: 'instagram.com',
      $initial_utm_source: 'ig',
    });
  });

  it('leaves an external initial referrer and a direct visit alone', () => {
    sessionStorage.setItem(LANDING_REFERRER_KEY, 'https://instagram.com/');
    const external = {
      $set_once: {
        $initial_referrer: 'https://www.google.com/',
        $initial_referring_domain: 'www.google.com',
      },
    };
    restoreInitialReferrer(external);
    expect(external.$set_once.$initial_referrer).toBe(
      'https://www.google.com/'
    );

    const direct = { $set_once: { $initial_referrer: '$direct' } };
    restoreInitialReferrer(direct);
    expect(direct.$set_once.$initial_referrer).toBe('$direct');
  });
});
