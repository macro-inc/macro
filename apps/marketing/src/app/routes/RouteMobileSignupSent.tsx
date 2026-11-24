import { useLocation } from '@solidjs/router';
import { type Component, createSignal, onMount, Show } from 'solid-js';
import { MobileSignupMark } from '../components/graphics/MobileSignupMark';
import { analytics } from '../utils/utilAnalytic';
import {
  conversionAlreadyFired,
  MOBILE_WEB_SIGNUP_LEAD_VALUE,
  type MobileStorePlatform,
  markConversionFired,
  mobileStorePlatform,
  submittedEmail,
} from '../utils/utilMobileSignup';
import { setPageSeo } from '../utils/utilSeo';
import './RouteMobileSignup.css';

/**
 * Ad conversions for a mobile visitor who asked for a desktop signup link.
 * Lead, not CompleteRegistration: no account exists yet.
 */
export const reportMobileSignupLead = (): void => {
  analytics.trackMeta('Lead', {
    content_name: 'mobile_web_signup',
    value: MOBILE_WEB_SIGNUP_LEAD_VALUE,
    currency: 'USD',
  });
};

const STORES: Record<MobileStorePlatform, { url: string; buttonName: string }> =
  {
    ios: {
      url: 'https://apps.apple.com/us/app/macro-app/id6743133649',
      buttonName: 'mobile_signup_sent_app_store',
    },
    android: {
      url: 'https://play.google.com/store/apps/details?id=com.macro.workspace.mobile',
      buttonName: 'mobile_signup_sent_google_play',
    },
  };

/**
 * Confirmation step of the site's mobile email capture: the visitor has been
 * emailed a link to finish signing up on a computer. iOS and Android visitors
 * are also offered the app from their store.
 *
 * This page also owns the ad-platform conversions for the captured lead (Meta
 * Lead, Google Ads `mobile_web_lead`). The visitor has not created an account,
 * so this is not Meta CompleteRegistration — that fires once, server-side,
 * when an account is actually created.
 */
export const RouteMobileSignupSent: Component = () => {
  setPageSeo({
    title: 'Check your email — Macro',
    description: 'We sent you an email to continue onboarding on desktop.',
    path: '/mobile-signup-sent',
    // The tail of the signup flow — never a landing page from search.
    noindex: true,
  });

  const location = useLocation<{ email: string }>();

  // Present when the visitor got here by submitting the form (history state
  // survives a refresh; session storage covers a fresh tab in the same session).
  const email = (): string | null => location.state?.email ?? submittedEmail();

  // Hidden in the prerendered page; only the browser knows the platform.
  const [store, setStore] = createSignal<MobileStorePlatform>();

  onMount(() => {
    setStore(
      mobileStorePlatform(navigator.userAgent, navigator.maxTouchPoints)
    );

    // The email field can stay focused across this route change — force the
    // keyboard down even if blur-before-navigate was skipped somehow.
    (document.activeElement as HTMLElement | null)?.blur?.();

    const captured = email();
    // A direct visit captured nothing, so there is no lead to report.
    if (!captured || conversionAlreadyFired(captured)) return;
    markConversionFired(captured);

    analytics.track('mobile_web_signup_sent_viewed');
    reportMobileSignupLead();
    analytics.trackGoogleConversion('mobile_web_lead', {
      value: MOBILE_WEB_SIGNUP_LEAD_VALUE,
      currency: 'USD',
      transaction_id: captured,
    });
  });

  return (
    <section class="mobile-signup-card">
      <MobileSignupMark />
      <h1 class="mobile-signup-card-title">Continue onboarding on desktop</h1>
      <p class="mobile-signup-card-subtitle">
        <Show
          when={email()}
          fallback="Open the link on your computer to finish signing up."
        >
          {(address) => (
            <>
              We emailed{' '}
              <span
                style={{
                  color: 'var(--color-ink)',
                  'overflow-wrap': 'anywhere',
                }}
              >
                {address()}
              </span>{' '}
              a link. Open it on your computer to finish signing up.
            </>
          )}
        </Show>
      </p>
      <Show when={store()}>
        {(platform) => (
          <div class="mobile-signup-card-body">
            <a
              href={STORES[platform()].url}
              class="mobile-signup-card-pill"
              target="_blank"
              rel="noreferrer"
              onClick={() => {
                analytics.track('app_redirect', {
                  page_location: window.location.href,
                  button_name: STORES[platform()].buttonName,
                });
              }}
            >
              Download our mobile app
            </a>
          </div>
        )}
      </Show>
    </section>
  );
};
