import { ctaHref, handleCtaClick } from '../../utils/utilCta';

/**
 * Full-width "Get started" pill for phones, where desktop shows the pill bar.
 * Same destination and `app_redirect` tracking as the desktop button: phones
 * sign up and onboard in the app like everyone else.
 */
export function LinkGetStarted(props: { buttonName: string }) {
  return (
    <>
      <style>{`
        .link-get-started { transition: transform 160ms ease; }
        .link-get-started:active { transform: scale(0.98); }
        @media (prefers-reduced-motion: reduce) {
          .link-get-started, .link-get-started:active { transition: none; transform: none; }
        }
      `}</style>
      <a
        href={ctaHref()}
        target="_self"
        class="link-get-started"
        onClick={(event) => handleCtaClick(event, props.buttonName)}
        style={{
          'align-items': 'center',
          'background-color': 'var(--c1)',
          border: '1px solid transparent',
          'border-radius': '999px',
          'box-sizing': 'border-box',
          color: 'var(--b0)',
          cursor: 'default',
          display: 'flex',
          'font-family': 'body',
          'font-size': '16px',
          'font-weight': '700',
          height: '46px',
          'justify-content': 'center',
          'letter-spacing': '0.01em',
          'line-height': 1,
          'max-width': '420px',
          'text-decoration': 'none',
          width: '100%',
        }}
      >
        Get started free
      </a>
    </>
  );
}
