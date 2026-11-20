import { describe, expect, it, vi } from 'vitest';
import { reportMobileSignupLead } from './RouteMobileSignupSent';

const analytics = vi.hoisted(() => ({
  trackMeta: vi.fn(),
}));

vi.mock('../utils/utilAnalytic', () => ({ analytics }));

describe('mobile signup link confirmation', () => {
  it('reports a Lead and not CompleteRegistration', () => {
    reportMobileSignupLead();

    expect(analytics.trackMeta).toHaveBeenCalledTimes(1);
    expect(analytics.trackMeta).toHaveBeenCalledWith('Lead', {
      content_name: 'mobile_web_signup',
      value: 5,
      currency: 'USD',
    });
    expect(analytics.trackMeta).not.toHaveBeenCalledWith(
      'CompleteRegistration',
      expect.anything()
    );
  });
});
