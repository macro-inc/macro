import { useLocation } from '@solidjs/router';
import { type Component, type JSX, onMount } from 'solid-js';
import { analytics } from '../utils/utilAnalytic';
import { buildAppUrl } from '../utils/utilBaseUrl';
import { viewportWidth } from '../utils/utilBreakpoint';
import {
  conversionAlreadyFired,
  MOBILE_WEB_SIGNUP_LEAD_VALUE,
  markConversionFired,
  submittedEmail,
} from '../utils/utilMobileSignup';
import { setPageSeo } from '../utils/utilSeo';

/** The Macro iOS app — the back door for visitors who already have an account. */
const APP_STORE_URL = 'https://apps.apple.com/us/app/macro-app/id6743133649';

const SUCCESS_GREEN = 'oklch(0.74 0.17 155)';

const secondaryButtonStyle = {
  'align-items': 'center',
  'background-color': 'transparent',
  border: '1px solid color-mix(in srgb, var(--b4) 38%, transparent)',
  'border-radius': '999px',
  'box-sizing': 'border-box',
  color: 'var(--c1)',
  display: 'inline-flex',
  'font-family': 'body',
  'font-size': '16px',
  'font-weight': '600',
  height: '46px',
  'justify-content': 'center',
  'line-height': 1,
  'text-decoration': 'none',
  width: '100%',
} as const;

/** Circle + check that draws in to confirm the email was sent. */
function SentCheck(props: { style?: JSX.CSSProperties }): JSX.Element {
  return (
    <div
      aria-hidden="true"
      class="mobile-signup-sent-check"
      style={{
        display: 'block',
        height: '52px',
        width: '52px',
        ...props.style,
      }}
    >
      <style>{`
        .mobile-signup-sent-check__svg {
          display: block;
          height: 100%;
          width: 100%;
        }
        .mobile-signup-sent-check__circle,
        .mobile-signup-sent-check__mark {
          fill: none;
          stroke: ${SUCCESS_GREEN};
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        .mobile-signup-sent-check__circle {
          stroke-width: 2.25;
          stroke-dasharray: 151;
          stroke-dashoffset: 151;
        }
        .mobile-signup-sent-check__mark {
          stroke-width: 3;
          stroke-dasharray: 48;
          stroke-dashoffset: 48;
        }
        @media (prefers-reduced-motion: no-preference) {
          .mobile-signup-sent-check__circle {
            animation: mobile-signup-sent-circle 520ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
          }
          .mobile-signup-sent-check__mark {
            animation: mobile-signup-sent-mark 380ms cubic-bezier(0.22, 1, 0.36, 1) 360ms forwards;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .mobile-signup-sent-check__circle,
          .mobile-signup-sent-check__mark {
            stroke-dashoffset: 0;
          }
        }
        @keyframes mobile-signup-sent-circle {
          to { stroke-dashoffset: 0; }
        }
        @keyframes mobile-signup-sent-mark {
          to { stroke-dashoffset: 0; }
        }
      `}</style>
      <svg
        class="mobile-signup-sent-check__svg"
        viewBox="0 0 52 52"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle
          class="mobile-signup-sent-check__circle"
          cx="26"
          cy="26"
          r="24"
        />
        <path
          class="mobile-signup-sent-check__mark"
          d="M15.5 26.5l7.5 7.5 14-14.5"
        />
      </svg>
    </div>
  );
}

/**
 * Confirmation step of the site's mobile email capture: the visitor has been
 * emailed a link to finish signing up on a computer.
 *
 * This page also owns the ad-platform conversions for the captured lead (Meta
 * Lead + CompleteRegistration, Google Ads `mobile_web_lead`) — they used to
 * fire from the equivalent screen in the app, and the campaigns that optimize
 * against them are unchanged, so the payloads here match what the app sent.
 */
export const RouteMobileSignupSent: Component = () => {
  setPageSeo({
    title: 'Check your email — Macro',
    description: 'We sent you a link to set up Macro on your computer.',
    path: '/mobile-signup-sent',
    // The tail of the signup flow — never a landing page from search.
    noindex: true,
  });

  const location = useLocation<{ email: string }>();
  const mobile = () => viewportWidth() < 700;

  // Present when the visitor got here by submitting the form (history state
  // survives a refresh; session storage covers a fresh tab in the same session).
  const email = (): string | null => location.state?.email ?? submittedEmail();

  onMount(() => {
    // Header signup field can stay mounted across this route change — force the
    // keyboard down even if blur-before-navigate was skipped somehow.
    (document.activeElement as HTMLElement | null)?.blur?.();

    const captured = email();
    // A direct visit captured nothing, so there is no lead to report.
    if (!captured || conversionAlreadyFired(captured)) return;
    markConversionFired(captured);

    analytics.track('mobile_web_signup_sent_viewed');
    // Fired as both Lead and CompleteRegistration: Meta's Maximize Value
    // campaigns don't support Lead, and an existing custom conversion in a live
    // ad campaign is built on Lead — so both have to keep coming.
    const leadPayload = {
      content_name: 'mobile_web_signup',
      value: MOBILE_WEB_SIGNUP_LEAD_VALUE,
      currency: 'USD',
    };
    analytics.trackMeta('Lead', leadPayload);
    analytics.trackMeta('CompleteRegistration', leadPayload);
    analytics.trackGoogleConversion('mobile_web_lead', {
      value: MOBILE_WEB_SIGNUP_LEAD_VALUE,
      currency: 'USD',
      transaction_id: captured,
    });
  });

  return (
    <section
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: '32px',
        'justify-items': 'start',
        'max-width': '520px',
        // Match the home hero inset (page gutter + these paddings).
        'padding-bottom': '96px',
        'padding-left': mobile() ? '18px' : '64px',
        'padding-right': mobile() ? '18px' : '24px',
        'padding-top': mobile() ? '96px' : '128px',
        width: '100%',
      }}
    >
      <SentCheck />

      <h1
        style={{
          color: 'var(--c0)',
          'font-family': 'display',
          'font-size': mobile() ? 'clamp(28px, 7.5vw, 36px)' : '40px',
          'font-weight': '380',
          'letter-spacing': '-0.012em',
          'line-height': 1.22,
          margin: '0',
        }}
      >
        Check your email → complete onboarding on your computer.
      </h1>

      <p
        style={{
          color: 'var(--c2)',
          'font-family': 'cyberreader',
          'font-size': '17px',
          'font-weight': '400',
          'line-height': 1.5,
          margin: '0',
          'max-width': '40ch',
        }}
      >
        Macro has a mobile app, but to get started you need to complete the
        onboarding on desktop.
      </p>

      <div
        style={{
          'border-top':
            '1px solid color-mix(in srgb, var(--b4) 24%, transparent)',
          'box-sizing': 'border-box',
          display: 'grid',
          gap: '12px',
          'margin-top': '8px',
          'padding-top': '28px',
          width: '100%',
        }}
      >
        <p
          style={{
            color: 'var(--c2)',
            'font-family': 'body',
            'font-size': '15px',
            'font-weight': '600',
            'line-height': 1.5,
            margin: '0',
          }}
        >
          Already a user?
        </p>

        <a
          href={buildAppUrl('/app/login')}
          onClick={(event) => {
            event.preventDefault();
            analytics.track('app_redirect', {
              page_location: window.location.href,
              button_name: 'mobile_signup_sent_login',
            });
            window.location.href = buildAppUrl('/app/login');
          }}
          style={secondaryButtonStyle}
        >
          Log in
        </a>

        <a
          href={APP_STORE_URL}
          target="_blank"
          rel="noreferrer"
          onClick={() => {
            analytics.track('app_redirect', {
              page_location: window.location.href,
              button_name: 'mobile_signup_sent_app_store',
            });
          }}
          style={secondaryButtonStyle}
        >
          Download the iOS app
        </a>

        <p
          style={{
            color: 'color-mix(in srgb, var(--c4) 78%, transparent)',
            'font-family': 'body',
            'font-size': '14px',
            'line-height': 1.5,
            margin: '0',
            'margin-top': '4px',
          }}
        >
          New to Macro? These are for existing accounts — sign up on your
          computer using the link we just emailed you.
        </p>
      </div>
    </section>
  );
};
