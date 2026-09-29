import IconGithub from '../../../assets/icons/icon-github.svg';
import { breakpoint } from '../../utils/utilBreakpoint';

const items = [
  {
    label: 'Extensible',
    body: 'Macro is designed so new workflows can plug into the same shared context instead of living as disconnected add-ons.',
  },
  {
    label: 'Modular',
    body: 'Email, messages, docs, tasks, files, and AI work as distinct pieces, but they share one interface and one underlying memory of the work.',
  },
  {
    label: 'Source available',
    body: 'The code is available on GitHub for teams that want to inspect how Macro is put together and follow its direction more closely.',
  },
] as const;

export function SectionExtensibility() {
  return (
    <div
      style={{
        display: 'grid',
        gap: breakpoint() ? '20px' : '28px',
      }}
    >
      <div
        style={{
          display: 'grid',
          gap: '16px',
          'max-width': '760px',
        }}
      >
        <div
          style={{
            color: 'var(--a0)',
            'font-size': '12px',
            'font-weight': '500',
            'letter-spacing': '0.08em',
            'text-transform': 'uppercase',
          }}
        >
          03 Open system
        </div>
        <div
          style={{
            'font-family': 'display',
            'font-size': breakpoint() ? '24px' : '32px',
            'font-weight': '450',
            'letter-spacing': '-0.02em',
            'line-height': breakpoint() ? '28px' : '36px',
          }}
        >
          Software should be moddable.
        </div>
        <div
          style={{
            color: 'var(--c4)',
            'font-size': breakpoint() ? '16px' : '20px',
            'line-height': breakpoint() ? '22px' : '28px',
            'max-width': '720px',
          }}
        >
          The best work software should not feel like a hostage situation. Macro
          is structured so teams can understand how the pieces fit together,
          adapt workflows over time, and build on top of a system that is
          visible rather than sealed off.
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gap: breakpoint() ? '1.5px' : '0',
          'grid-template-columns': breakpoint()
            ? '1fr'
            : 'repeat(3, minmax(0, 1fr))',
        }}
      >
        {items.map((item, index) => (
          <div
            style={{
              'border-top': '1px solid var(--b2)',
              'border-left':
                breakpoint() || index === 0 ? 'none' : '1px solid var(--b2)',
              display: 'grid',
              gap: '14px',
              'min-height': breakpoint() ? undefined : '180px',
              padding: breakpoint() ? '18px 0 0' : '20px 24px 0 24px',
            }}
          >
            <div
              style={{
                color: 'var(--a0)',
                'font-family': 'display',
                'font-size': '18px',
                'font-weight': '450',
                'letter-spacing': '-0.01em',
              }}
            >
              {item.label}
            </div>
            <div
              style={{
                color: 'var(--c4)',
                'font-size': breakpoint() ? '15px' : '17px',
                'line-height': '1.6',
                'max-width': '280px',
              }}
            >
              {item.body}
            </div>
            {item.label === 'Source available' ? (
              <a
                href="https://github.com/macro-inc/macro"
                target="_blank"
                style={{
                  'align-items': 'center',
                  color: 'var(--c2)',
                  display: 'inline-flex',
                  gap: '6px',
                  'text-decoration': 'none',
                  width: 'fit-content',
                }}
                rel="noopener"
              >
                <span>View on GitHub</span>
                <IconGithub style={{ width: '16px' }} />
              </a>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
