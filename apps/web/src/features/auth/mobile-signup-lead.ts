import type { AnalyticsInterface } from '@app/lib/analytics/analytics';
import { MOBILE_WEB_SIGNUP_LEAD_VALUE } from '@app/lib/analytics/leadValues';

/**
 * Meta conversion for the mobile "email me a desktop link" form. The visitor
 * has not created an account, so this is a Lead and not CompleteRegistration.
 */
export function reportMobileWebSignupLead(
  analytics: Pick<AnalyticsInterface, 'trackMeta'>
) {
  analytics.trackMeta('Lead', {
    content_name: 'mobile_web_signup',
    value: MOBILE_WEB_SIGNUP_LEAD_VALUE,
    currency: 'USD',
  });
}
