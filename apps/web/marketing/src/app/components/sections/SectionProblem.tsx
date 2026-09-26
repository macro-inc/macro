import { breakpoint } from '../../utils/utilBreakpoint';

const problemPoints = [
  'Slack pings during deep work.',
  'Gmail threads nobody can find later.',
  'Docs, tasks, files, and AI conversations split across separate tabs.',
] as const;

export function SectionProblem() {
  return (
    <div
      style={{
        display: 'grid',
        'grid-template-columns': breakpoint()
          ? '1fr'
          : 'minmax(0, 1.25fr) minmax(0, 0.9fr)',
        gap: breakpoint() ? '20px' : '40px',
        'align-items': 'start',
      }}
    >
      <div
        style={{
          display: 'grid',
          gap: '16px',
        }}
      >
        <div
          style={{
            'font-family': 'display',
            'font-size': breakpoint() ? '24px' : '32px',
            'font-weight': '450',
            'letter-spacing': '-0.02em',
            'line-height': breakpoint() ? '28px' : '36px',
          }}
        >
          Your stack is the bottleneck.
        </div>
        <div
          style={{
            color: 'var(--c4)',
            'font-size': breakpoint() ? '16px' : '20px',
            'line-height': breakpoint() ? '22px' : '28px',
            'max-width': '620px',
          }}
        >
          Slack, Gmail, docs, tasks, files, and AI each work on their own, but
          together they create a coordination layer that steals attention. The
          bloated SaaS stack fragments context, interrupts deep work, and leaves
          teams feeling behind even when they have been working all day.
        </div>
      </div>

      <div
        style={{
          border: '1px solid var(--b2)',
          'border-radius': '5px',
          display: 'grid',
          gap: '14px',
          padding: '18px',
        }}
      >
        {problemPoints.map((point) => (
          <div
            style={{
              'align-items': 'start',
              color: 'var(--c3)',
              display: 'grid',
              gap: '12px',
              'grid-template-columns': '12px 1fr',
              'line-height': '1.55',
            }}
          >
            <div
              style={{
                'background-color': 'var(--a0)',
                'border-radius': '999px',
                height: '8px',
                'margin-top': '8px',
                width: '8px',
              }}
            />
            <div>{point}</div>
          </div>
        ))}
        <div
          style={{
            color: 'var(--c2)',
            'font-size': breakpoint() ? '15px' : '16px',
            'line-height': '1.6',
            'padding-top': '6px',
          }}
        >
          The result is more context switching, more duplicated discussion, and
          more time spent coordinating instead of doing the work itself.
        </div>
      </div>
    </div>
  );
}
