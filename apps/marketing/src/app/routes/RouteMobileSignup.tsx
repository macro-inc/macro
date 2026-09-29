import { type Component, Show } from 'solid-js';
import { LinkBookDemo } from '../components/buttons/LinkBookDemo';
import { FormMobileSignup } from '../components/forms/FormMobileSignup';
import { MacroMarkIcon } from '../components/graphics/MacroMarkIcon';
import { analytics } from '../utils/utilAnalytic';
import { buildAppUrl, buildGoogleSsoUrl } from '../utils/utilBaseUrl';
import { viewportWidth } from '../utils/utilBreakpoint';
import { isMobileWebDevice } from '../utils/utilCta';
import { setPageSeo } from '../utils/utilSeo';

/**
 * Email-capture page for mobile visitors, the destination of every mobile CTA
 * outside the home hero (which captures inline). Same two steps as before —
 * email, then "check your inbox" — but served by the site, so there is no app
 * bundle to download first.
 */
export const RouteMobileSignup: Component = () => {
  setPageSeo({
    title: 'Start for free — Macro',
    description:
      'Enter your email and we will send you a link to set up Macro on your computer.',
    path: '/mobile-signup',
    // A step inside the signup flow: useful to visitors, not a search result.
    noindex: true,
  });

  const mobile = () => viewportWidth() < 700;

  return (
    <section
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: '20px',
        'justify-items': 'start',
        'max-width': '520px',
        'padding-bottom': '96px',
        'padding-top': mobile() ? '112px' : '148px',
        width: '100%',
      }}
    >
      <MacroMarkIcon
        style={{ color: 'var(--a0)', height: '30px', width: '46px' }}
      />

      <h1
        style={{
          color: 'var(--c0)',
          'font-family': 'display',
          'font-size': mobile() ? 'clamp(38px, 11vw, 48px)' : '48px',
          'font-weight': '380',
          'letter-spacing': '-0.012em',
          'line-height': 1.12,
          margin: '0',
        }}
      >
        One app for
        <br />
        all your work.
      </h1>

      <p
        style={{
          color: 'var(--c2)',
          'font-family': 'body',
          'font-size': '17px',
          'font-weight': '400',
          'line-height': 1.5,
          margin: '0',
          'max-width': '38ch',
        }}
      >
        Macro sets up on your computer. Drop your email and we&rsquo;ll send you
        a link to start — it takes about a minute at your desk.
      </p>

      <FormMobileSignup buttonName="mobile_signup_page" />
      <LinkBookDemo buttonName="mobile_signup_page_book_demo" />

      <Show when={!isMobileWebDevice()}>
        <a
          href={buildGoogleSsoUrl()}
          onClick={(event) => {
            event.preventDefault();
            analytics.track('app_redirect', {
              page_location: window.location.href,
              button_name: 'mobile_signup_page_google',
            });
            window.location.href = buildGoogleSsoUrl();
          }}
          style={{
            color: 'var(--c2)',
            'font-family': 'body',
            'font-size': '15px',
            'text-decoration': 'underline',
            'text-underline-offset': '3px',
          }}
        >
          On a computer? Sign up with Google now
        </a>
      </Show>

      <p
        style={{
          color: 'color-mix(in srgb, var(--c4) 78%, transparent)',
          'font-family': 'body',
          'font-size': '15px',
          'line-height': 1.5,
          margin: '0',
          'margin-top': '8px',
        }}
      >
        Already have an account?{' '}
        <a
          href={buildAppUrl('/app/login')}
          onClick={(event) => {
            event.preventDefault();
            analytics.track('app_redirect', {
              page_location: window.location.href,
              button_name: 'mobile_signup_page_login',
            });
            window.location.href = buildAppUrl('/app/login');
          }}
          style={{
            color: 'var(--c1)',
            'text-decoration': 'underline',
            'text-underline-offset': '3px',
          }}
        >
          Log in
        </a>
      </p>
    </section>
  );
};
