import { describe, expect, it } from 'vitest';
import {
  mobileCaptureDevice,
  mobileCaptureSetOnce,
  normalizeAnalyticsEmail,
  pickMobileCaptureAttribution,
} from './utilMobileCaptureIdentity';

describe('mobile capture identity', () => {
  it('normalizes email casing and surrounding space', () => {
    expect(normalizeAnalyticsEmail(' Dartagnan@CtrlStrategies.com ')).toBe(
      'dartagnan@ctrlstrategies.com'
    );
    expect(normalizeAnalyticsEmail(null)).toBe('');
  });

  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'mobile'],
    ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 'tablet'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel) Mobile', 'mobile'],
    ['Mozilla/5.0 (Linux; Android 14; SM-T870)', 'tablet'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'desktop'],
  ])('classifies %s as %s', (userAgent, device) => {
    expect(mobileCaptureDevice(userAgent)).toBe(device);
  });

  it('keeps the ad click ids the capture should remember', () => {
    expect(
      mobileCaptureSetOnce({
        capturedAt: '2026-10-14T12:00:00.000Z',
        device: 'mobile',
        search:
          '?utm_source=ig&utm_medium=paid&utm_campaign=spring&utm_content=story&utm_term=skip&fbclid=click&gclid=ads',
      })
    ).toEqual({
      mobile_capture_at: '2026-10-14T12:00:00.000Z',
      mobile_capture_device: 'mobile',
      utm_source: 'ig',
      utm_medium: 'paid',
      utm_campaign: 'spring',
      utm_content: 'story',
      fbclid: 'click',
    });
    expect(
      pickMobileCaptureAttribution({
        utm_source: 'ig',
        gclid: 'ads',
        fbclid: '',
      })
    ).toEqual({ utm_source: 'ig' });
  });
});
