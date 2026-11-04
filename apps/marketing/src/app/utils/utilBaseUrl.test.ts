import { afterEach, describe, expect, it } from 'vitest';
import { capturedAttribution } from './utilBaseUrl';

afterEach(() => {
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('capturedAttribution', () => {
  it('keeps ad parameters after the query string is gone and drops anything else', () => {
    sessionStorage.clear();
    window.history.replaceState(
      {},
      '',
      '/?utm_source=facebook&utm_medium=paid&utm_campaign=spring&fbclid=IwAR&ref=friend'
    );

    expect(capturedAttribution()).toEqual({
      utm_source: 'facebook',
      utm_medium: 'paid',
      utm_campaign: 'spring',
      fbclid: 'IwAR',
    });

    window.history.replaceState({}, '', '/mobile-signup');
    expect(capturedAttribution()).toEqual({
      utm_source: 'facebook',
      utm_medium: 'paid',
      utm_campaign: 'spring',
      fbclid: 'IwAR',
    });
  });
});
