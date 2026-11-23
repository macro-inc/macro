import { describe, expect, it, vi } from 'vitest';
import { reportMobileWebSignupLead } from './mobile-signup-lead';

describe('mobile web signup lead', () => {
  it('reports a Lead and not CompleteRegistration', () => {
    const trackMeta = vi.fn();
    reportMobileWebSignupLead({ trackMeta });

    expect(trackMeta).toHaveBeenCalledTimes(1);
    expect(trackMeta).toHaveBeenCalledWith('Lead', {
      content_name: 'mobile_web_signup',
      value: 5,
      currency: 'USD',
    });
  });
});
