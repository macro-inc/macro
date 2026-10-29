import { setCookie } from '@core/util/cookies';
import { afterEach, describe, expect, it } from 'vitest';
import {
  adAttributionForCapture,
  mobileEmailPersonProperties,
  rememberMobileEmailAttribution,
} from './signupAttribution';

const clearCookies = () => {
  for (const part of document.cookie.split(';')) {
    const name = part.split('=')[0]?.trim();
    if (!name) continue;
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
};

afterEach(() => {
  clearCookies();
  window.history.replaceState({}, '', '/');
});

describe('mobile email attribution', () => {
  it('keeps the desktop link parameters after the query string is gone', () => {
    window.history.replaceState(
      {},
      '',
      '/app/signup?utm_source=facebook&utm_campaign=spring%20sale&fbclid=IwAR&signup_flow=mobile_email&unrelated=1'
    );
    rememberMobileEmailAttribution();
    window.history.replaceState({}, '', '/app/onboarding?signed_up=true');

    expect(mobileEmailPersonProperties()).toEqual({
      set: {
        signup_flow: 'mobile_email',
        utm_source: 'facebook',
        utm_campaign: 'spring sale',
        fbclid: 'IwAR',
      },
      once: {
        $initial_signup_flow: 'mobile_email',
        $initial_utm_source: 'facebook',
        $initial_utm_campaign: 'spring sale',
        $initial_fbclid: 'IwAR',
      },
    });
  });

  it('ignores an ordinary visit and drops values that are not safe in a url', () => {
    window.history.replaceState({}, '', '/app/signup?utm_source=facebook');
    rememberMobileEmailAttribution();
    window.history.replaceState({}, '', '/app/onboarding');
    expect(mobileEmailPersonProperties()).toBeNull();

    window.history.replaceState(
      {},
      '',
      '/app/signup?signup_flow=mobile_email&utm_source=%3Cscript%3E&utm_medium=paid'
    );
    rememberMobileEmailAttribution();
    window.history.replaceState({}, '', '/app/welcome');
    expect(mobileEmailPersonProperties()).toEqual({
      set: { signup_flow: 'mobile_email', utm_medium: 'paid' },
      once: {
        $initial_signup_flow: 'mobile_email',
        $initial_utm_medium: 'paid',
      },
    });
  });

  it('sends the capture page parameters, with the url winning over an older cookie', () => {
    setCookie('utm_source', 'newsletter', 1);
    setCookie('utm_medium', 'email', 1);
    window.history.replaceState(
      {},
      '',
      '/app/mobile-email-signup?utm_source=facebook&page=1'
    );
    expect(adAttributionForCapture()).toEqual({
      utm_source: 'facebook',
      utm_medium: 'email',
    });
  });
});
