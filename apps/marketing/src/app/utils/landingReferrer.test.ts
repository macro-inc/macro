import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attributionReferrer,
  LANDING_REFERRER_KEY,
  rememberLandingReferrer,
} from './landingReferrer';

const referrer = (value: string) => {
  vi.spyOn(document, 'referrer', 'get').mockReturnValue(value);
};

describe('landing referrer', () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('stores an external referrer and reports it', () => {
    referrer('https://l.instagram.com/');
    expect(attributionReferrer()).toBe('https://l.instagram.com/');
    expect(sessionStorage.getItem(LANDING_REFERRER_KEY)).toBe(
      'https://l.instagram.com/'
    );
  });

  it('reports the stored external referrer after a same-site hop', () => {
    referrer('https://instagram.com/');
    rememberLandingReferrer();
    referrer(`${window.location.origin}/?utm_source=ig&utm_medium=cpc`);
    expect(attributionReferrer()).toBe('https://instagram.com/');
    expect(sessionStorage.getItem(LANDING_REFERRER_KEY)).toBe(
      'https://instagram.com/'
    );
  });

  it('treats a www hop as the same site', () => {
    referrer('https://www.facebook.com/');
    rememberLandingReferrer();
    referrer(`http://www.${window.location.hostname}/?utm_source=fb`);
    expect(attributionReferrer()).toBe('https://www.facebook.com/');
  });

  it('keeps a same-site referrer when nothing external was stored', () => {
    const hop = `${window.location.origin}/?utm_source=ig`;
    referrer(hop);
    expect(attributionReferrer()).toBe(hop);
    expect(sessionStorage.getItem(LANDING_REFERRER_KEY)).toBeNull();
  });

  it('drops a saved referrer on a direct load so the next hop stays direct', () => {
    sessionStorage.setItem(LANDING_REFERRER_KEY, 'https://instagram.com/');
    referrer('');
    expect(attributionReferrer()).toBe('');
    expect(sessionStorage.getItem(LANDING_REFERRER_KEY)).toBeNull();

    referrer(`${window.location.origin}/`);
    expect(attributionReferrer()).toBe(`${window.location.origin}/`);
  });

  it('replaces the stored referrer when a new external source loads', () => {
    referrer('https://instagram.com/');
    rememberLandingReferrer();
    referrer('https://www.google.com/');
    expect(attributionReferrer()).toBe('https://www.google.com/');
    expect(sessionStorage.getItem(LANDING_REFERRER_KEY)).toBe(
      'https://www.google.com/'
    );
  });

  it('ignores an unparseable referrer', () => {
    sessionStorage.setItem(LANDING_REFERRER_KEY, 'https://instagram.com/');
    referrer('not a url');
    rememberLandingReferrer();
    expect(sessionStorage.getItem(LANDING_REFERRER_KEY)).toBe(
      'https://instagram.com/'
    );
  });
});
