import IconGithub from '../../../assets/icons/icon-github.svg';
import { breakpoint } from '../../utils/utilBreakpoint';

export function SectionCta() {
  return (
    <div
      style={{
        display: 'grid',
        'padding-bottom': breakpoint() ? '64px' : '80px',
        gap: breakpoint() ? '24px' : '28px',
        'justify-items': 'center',
        'text-align': 'center',
      }}
    >
      <div
        style={{
          'font-size': breakpoint() ? '24px' : '30px',
          'letter-spacing': '-0.018em',
          'max-width': '730px',
          'line-height': 1.25,
          'font-family': 'display',
          'font-weight': '450',
        }}
      >
        Designed by engineers obsessed with performance for the kind of people
        who notice.
      </div>
      <div
        style={{
          'font-size': breakpoint() ? '18px' : '22px',
          color: 'var(--c4)',
          'line-height': 1.32,
          'max-width': '530px',
        }}
      >
        Macro is built in Rust for speed. It's source-available and modular so
        you can build your company around it.
      </div>
      <a
        href="https://github.com/macro-inc/macro"
        target="_blank"
        rel="noreferrer"
        class="hover-relaunch"
        style={{
          transition: 'color var(--transition)',
          'text-decoration': 'none',
          'border-radius': '3px',
          width: 'min-content',
          'white-space': 'nowrap',
          overflow: 'hidden',
          'box-sizing': 'border-box',
          'font-family': 'body',
          'background-color': 'var(--c0)',
          'justify-content': 'center',
          gap: '8px',
          'letter-spacing': '0.045em',
          'text-transform': 'uppercase',
          padding: '0 20px',
          'font-size': '18px',
          'font-weight': '700',
          'line-height': '1',
          'align-items': 'center',
          color: 'var(--b0)',
          cursor: 'default',
          height: '34px',
          display: 'inline-flex',
        }}
      >
        <IconGithub
          style={{
            width: '14px',
            height: '14px',
            display: 'block',
          }}
        />
        GitHub
      </a>
    </div>
  );
}
