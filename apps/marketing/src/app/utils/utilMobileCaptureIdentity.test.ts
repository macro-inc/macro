import { describe, expect, it } from 'vitest';
import { pickMobileCaptureAttribution } from './utilMobileCaptureIdentity';

describe('campaign attribution', () => {
  it('keeps the ad click ids worth remembering', () => {
    expect(
      pickMobileCaptureAttribution({
        utm_source: 'ig',
        utm_medium: 'paid',
        utm_campaign: 'spring',
        utm_content: 'story',
        utm_term: 'skip',
        fbclid: 'click',
        gclid: 'ads',
      })
    ).toEqual({
      utm_source: 'ig',
      utm_medium: 'paid',
      utm_campaign: 'spring',
      utm_content: 'story',
      fbclid: 'click',
    });
  });
});
