import { breakpoint } from '../../utils/utilBreakpoint';

const steps = [
  {
    step: '01',
    title: 'Start with one team',
    body: 'Pick the group that feels the most coordination drag today, usually engineering, product, or founders.',
  },
  {
    step: '02',
    title: 'Move one workflow at a time',
    body: 'Bring over the work that gets referenced constantly: messages, docs, tasks, files, and the conversations around them.',
  },
  {
    step: '03',
    title: 'Let the context compound',
    body: 'Once the work and its history live together, search, handoffs, and follow-up get easier without forcing an all-at-once switch.',
  },
] as const;

export function SectionPlan() {
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
          'max-width': '720px',
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
          How to migrate without blowing up your workflow.
        </div>
        <div
          style={{
            color: 'var(--c4)',
            'font-size': breakpoint() ? '16px' : '20px',
            'line-height': breakpoint() ? '22px' : '28px',
          }}
        >
          Most teams are not going to rip out every tool in a week. The easier
          path is to start with one team, move the work that creates the most
          context switching, and let the rest follow.
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gap: breakpoint() ? '20px' : '0',
          'grid-template-columns': breakpoint()
            ? '1fr'
            : 'repeat(3, minmax(0, 1fr))',
        }}
      >
        {steps.map((item) => (
          <div
            style={{
              display: 'grid',
              gap: '14px',
              'min-height': breakpoint() ? undefined : '190px',
              padding: breakpoint() ? '18px 0 0' : '20px 24px 0 0',
              'border-top': '1px solid var(--b2)',
              'border-left': breakpoint()
                ? 'none'
                : item.step === '01'
                  ? 'none'
                  : '1px solid var(--b2)',
              'padding-left': breakpoint()
                ? '0'
                : item.step === '01'
                  ? '0'
                  : '24px',
            }}
          >
            <div
              style={{
                color: 'var(--a0)',
                'font-family': 'display',
                'font-size': '14px',
                'font-weight': '500',
                'letter-spacing': '0.04em',
              }}
            >
              {item.step}
            </div>
            <div
              style={{
                'font-family': 'display',
                'font-size': breakpoint() ? '20px' : '24px',
                'font-weight': '450',
                'letter-spacing': '-0.02em',
                'line-height': breakpoint() ? '24px' : '28px',
                'max-width': '240px',
              }}
            >
              {item.title}
            </div>
            <div
              style={{
                color: 'var(--c4)',
                'font-size': breakpoint() ? '15px' : '17px',
                'line-height': '1.6',
              }}
            >
              {item.body}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
