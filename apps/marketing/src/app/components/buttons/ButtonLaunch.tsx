import { analytics } from '../../utils/utilAnalytic';
import { buildAppUrl } from '../../utils/utilBaseUrl';
import { viewportWidth } from '../../utils/utilBreakpoint';

type ButtonLaunchProps = {
  size?: 'small' | 'default' | 'large';
  tone?: 'light' | 'dark' | 'accent';
  shortcut?: string;
  label?: string;
};

export function ButtonLaunch(props: ButtonLaunchProps) {
  const isSmall = props.size === 'small';
  const isLarge = props.size === 'large';
  const isDark = props.tone === 'dark';
  const isAccent = props.tone === 'accent';
  const shortcut = () => (viewportWidth() < 700 ? undefined : props.shortcut);

  return (
    <a
      style={{
        transition: 'color var(--transition)',
        'text-decoration': 'none',
        'border-radius': '3px',
        width: 'min-content',
        'white-space': 'nowrap',
        overflow: 'hidden',
        'box-sizing': 'border-box',
        'font-family': 'body',
        'background-color': isAccent
          ? 'var(--a0)'
          : isDark
            ? 'var(--b1)'
            : 'var(--c0)',
        border: isAccent
          ? 'none'
          : isDark
            ? '1px solid color-mix(in srgb, var(--b4) 28%, transparent)'
            : 'none',
        'justify-content': 'center',
        gap: shortcut()
          ? isLarge
            ? '12px'
            : isSmall
              ? '8px'
              : '10px'
          : isLarge
            ? '12px'
            : '8px',
        'letter-spacing': '0.045em',
        'text-transform': 'uppercase',
        padding: shortcut()
          ? isLarge
            ? '0 9px 0 20px'
            : isSmall
              ? '0 7px 0 14px'
              : '0 8px 0 18px'
          : isLarge
            ? '0 24px'
            : isSmall
              ? '0 14px'
              : '0 18px',
        'font-size': shortcut()
          ? isLarge
            ? '20px'
            : isSmall
              ? '15px'
              : '16px'
          : isLarge
            ? '22px'
            : isSmall
              ? '16px'
              : '18px',
        'font-weight': '700',
        'line-height': '1',
        'align-items': 'center',
        color: isAccent ? 'var(--b0)' : isDark ? 'var(--c1)' : 'var(--b0)',
        cursor: 'default',
        height: shortcut()
          ? isLarge
            ? '38px'
            : isSmall
              ? '28px'
              : '32px'
          : isLarge
            ? '34px'
            : isSmall
              ? '26px'
              : '28px',
        display: 'inline-flex',
      }}
      onClick={(e) => {
        e.preventDefault();
        analytics.track('app_redirect', {
          page_location: window.location.href,
          button_name: 'sign_up',
        });
        window.location.href = buildAppUrl('/app/welcome');
      }}
      class={isAccent ? undefined : 'hover-relaunch'}
    >
      {props.label ?? 'Sign Up'}
      {shortcut() && (
        <span
          aria-hidden="true"
          style={{
            'align-items': 'center',
            border: `1px solid ${isAccent ? 'color-mix(in srgb, var(--b0) 18%, transparent)' : isDark ? 'color-mix(in srgb, var(--b4) 36%, transparent)' : 'color-mix(in srgb, var(--b0) 18%, transparent)'}`,
            'border-radius': '3px',
            'box-sizing': 'border-box',
            display: 'inline-flex',
            'font-size': isLarge ? '13px' : isSmall ? '10px' : '11px',
            'font-weight': '700',
            height: isLarge ? '25px' : isSmall ? '19px' : '22px',
            'justify-content': 'center',
            'line-height': 1,
            'min-width': isLarge ? '25px' : isSmall ? '19px' : '22px',
            opacity: 0.82,
          }}
        >
          {shortcut()}
        </span>
      )}
    </a>
  );
}
