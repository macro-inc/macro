import { analytics } from '../app/utils/utilAnalytic';
import { ctaHref } from '../app/utils/utilCta';
import DesignIcon from '../assets/designs/design-icon.svg';

export function Header() {
  const navItemStyle = {
    'font-family': 'Rajdhani',
    'font-size': '18px',
    'font-weight': '700',
    'letter-spacing': '0.02em',
    'text-decoration': 'none',
    color: 'var(--c4)',
    cursor: 'default',
    'white-space': 'nowrap',
  } as const;

  return (
    <header
      style={{
        display: 'grid',
        'justify-items': 'center',
        padding: '24px',
        position: 'relative',
        'z-index': 20,
      }}
    >
      <nav
        aria-label="Primary"
        style={{
          'align-items': 'center',
          'background-color': 'oklch(from var(--b1) l c h / 0.72)',
          border: '1px solid color-mix(in srgb, var(--c4) 18%, transparent)',
          'border-radius': '999px',
          'box-shadow':
            'var(--shadow-panel-sm), inset 0 1px 0 color-mix(in srgb, var(--c0) 8%, transparent)',
          'box-sizing': 'border-box',
          '-webkit-backdrop-filter': 'blur(14px) saturate(1.25)',
          'backdrop-filter': 'blur(14px) saturate(1.25)',
          display: 'grid',
          gap: '32px',
          'grid-template-columns': 'min-content 1fr min-content',
          'max-width': '860px',
          padding: '8px 10px 8px 22px',
          width: 'min(100%, 860px)',
        }}
      >
        <a
          href="/"
          class="hover-color"
          onClick={(event) => {
            event.preventDefault();
            window.location.href = '/';
          }}
          style={{
            'align-items': 'center',
            color: 'var(--c1)',
            cursor: 'default',
            display: 'inline-flex',
            'font-family': 'body',
            'font-size': '22px',
            'font-weight': '700',
            gap: '8px',
            'line-height': 1,
            'text-decoration': 'none',
            'white-space': 'nowrap',
          }}
        >
          <DesignIcon
            style={{
              color: 'var(--c1)',
              display: 'block',
              fill: 'currentColor',
              height: '24px',
              overflow: 'visible',
              stroke: 'none',
            }}
          />
          macro
        </a>

        <div
          style={{
            'align-items': 'center',
            display: 'flex',
            gap: '30px',
            'justify-content': 'center',
          }}
        >
          <a
            href="https://github.com/macro-inc/macro"
            target="_blank"
            rel="noreferrer"
            style={navItemStyle}
            class="hover-color"
          >
            GitHub
          </a>
          <a href="/#pricing" style={navItemStyle} class="hover-color">
            Pricing
          </a>
          <a
            href="https://www.youtube.com/channel/UCcn-1WTGff0X_RscGVtwljQ"
            target="_blank"
            rel="noreferrer"
            style={navItemStyle}
            class="hover-color"
          >
            Videos
          </a>
          <a href="/jobs" style={navItemStyle} class="hover-color">
            Careers
          </a>
        </div>

        <a
          href={ctaHref()}
          onClick={(event) => {
            event.preventDefault();
            analytics.track('app_redirect', {
              page_location: window.location.href,
              button_name: 'header_connect_google',
            });
            window.location.href = ctaHref();
          }}
          style={{
            'align-items': 'center',
            'background-color': 'var(--a0)',
            'border-radius': '999px',
            'box-sizing': 'border-box',
            color: 'var(--b0)',
            cursor: 'default',
            display: 'inline-flex',
            'font-family': 'body',
            'font-size': '18px',
            'font-weight': '700',
            height: '44px',
            'justify-content': 'center',
            'letter-spacing': '0.045em',
            'line-height': 1,
            padding: '0 24px',
            'text-decoration': 'none',
            'text-transform': 'uppercase',
            'white-space': 'nowrap',
          }}
        >
          Connect with Google
        </a>
      </nav>
    </header>
  );
}
