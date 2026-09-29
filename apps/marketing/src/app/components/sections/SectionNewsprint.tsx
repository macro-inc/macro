import DesignIcon from '../../../assets/designs/design-icon.svg';
import { viewportWidth } from '../../utils/utilBreakpoint';

export function SectionNewsprint() {
  const stacked = () => viewportWidth() < 800;

  const labelStyle = {
    'font-family': 'rajdhani, body',
    'font-size': viewportWidth() < 700 ? '12px' : '14px',
    'font-weight': '700',
    color: 'var(--a0)',
    'letter-spacing': '0.1em',
    'line-height': 1,
    'text-transform': 'uppercase',
  } as const;

  const comparisonCopyStyle = {
    'font-family': 'display',
    'font-size': viewportWidth() < 700 ? '25px' : '30px',
    color: 'var(--c4)',
    'overflow-wrap': 'break-word',
  } as const;

  const IconCircle = (props: { kind: 'problem' | 'solution' }) => (
    <svg
      width="24"
      height="24"
      viewBox="0 0 50 50"
      aria-hidden="true"
      style={{
        flex: '0 0 auto',
        display: 'block',
      }}
    >
      <circle
        cx="25"
        cy="25"
        r="21"
        fill="none"
        stroke="var(--a0)"
        stroke-width="1.6"
        opacity="0.72"
      />
      {props.kind === 'problem' ? (
        <path
          d="M18 18 L32 32 M32 18 L18 32"
          fill="none"
          stroke="var(--a0)"
          stroke-width="2.2"
          stroke-linecap="round"
        />
      ) : (
        <path
          d="M16.5 25.5 L22.5 31.5 L34 19"
          fill="none"
          stroke="var(--a0)"
          stroke-width="2.4"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      )}
    </svg>
  );

  return (
    <div
      style={{
        display: 'grid',
        'grid-template-columns': stacked()
          ? '1fr'
          : 'repeat(2, minmax(0, 1fr))',
        gap: '1px',
        'background-color': 'var(--b2)',
        'border-top': '1px solid var(--b2)',
        position: 'relative',
      }}
    >
      <div
        style={{
          display: 'grid',
          'background-color': 'var(--b0)',
          'box-sizing': 'border-box',
          'min-height': stacked() ? 'auto' : '236px',
          padding: viewportWidth() < 700 ? '32px 24px' : '46px 64px 52px 92px',
        }}
      >
        <div style={{ display: 'grid', gap: '18px' }}>
          <div
            style={{ 'align-items': 'center', display: 'flex', gap: '10px' }}
          >
            <IconCircle kind="problem" />
            <span style={labelStyle}>Before</span>
          </div>
          <div style={comparisonCopyStyle}>
            <span style={{ color: 'var(--c1)' }}>Our startup was messy.</span>
            <br />
            57 Slack channels.
            <br />
            Bugs in #bug-reports.
            <br />
            We were unfocused.
          </div>
        </div>
      </div>
      <div
        style={{
          display: 'grid',
          'background-color': 'var(--b0)',
          'box-sizing': 'border-box',
          'min-height': stacked() ? 'auto' : '236px',
          padding: viewportWidth() < 700 ? '32px 24px' : '46px 40px 52px 92px',
        }}
      >
        <div style={{ display: 'grid', gap: '18px' }}>
          <div
            style={{ 'align-items': 'center', display: 'flex', gap: '10px' }}
          >
            <IconCircle kind="solution" />
            <span style={labelStyle}>After</span>
          </div>
          <div style={comparisonCopyStyle}>
            <span style={{ color: 'var(--c1)' }}>Macro fixed our startup.</span>
            <br />
            We're systemized.
            <br />
            We have a cadence.
            <br />
            We're shipping fast.
          </div>
        </div>
      </div>
      {!stacked() && (
        <div
          aria-hidden="true"
          style={{
            'align-items': 'center',
            'background-color': 'oklch(from var(--b0) l c h / 0.92)',
            border: '1px solid var(--b2)',
            'border-radius': '999px',
            'box-shadow':
              '0 0 0 1px oklch(from var(--c0) l c h / 0.035), 0 18px 48px oklch(from var(--b0) l c h / 0.62)',
            display: 'grid',
            height: '70px',
            'justify-items': 'center',
            left: '50%',
            position: 'absolute',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: '70px',
          }}
        >
          <DesignIcon
            style={{
              display: 'block',
              fill: 'var(--a0)',
              height: '24px',
              overflow: 'visible',
              stroke: 'none',
            }}
          />
        </div>
      )}
    </div>
  );
}
