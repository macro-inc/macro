import IconCasa from '../../../assets/designs/design-casa.svg';
import IconIso from '../../../assets/designs/design-iso.svg';
import IconSoc2 from '../../../assets/designs/design-soc2.svg';
import { viewportWidth } from '../../utils/utilBreakpoint';

export function SectionSecurity(props: { gridArea?: string } = {}) {
  const mobile = () => viewportWidth() < 700;
  const crosshatch = {
    'background-color': 'var(--b0)',
    'background-image':
      'repeating-linear-gradient(315deg, var(--b2) 0, var(--b2) 1px, transparent 0, transparent 50%)',
    'background-size': '12px 12px',
  } as const;

  return (
    <section
      aria-label="Security and privacy"
      style={{
        'align-items': 'center',
        'box-sizing': 'border-box',
        display: 'grid',
        gap: mobile() ? '22px' : '32px',
        ...(props.gridArea ? { 'grid-area': props.gridArea } : {}),
        'grid-template-columns': mobile() ? '1fr' : 'minmax(0, 1fr) auto',
        'min-height': mobile() ? '150px' : '132px',
        padding: mobile() ? '24px 22px' : '24px 72px',
        position: 'relative',
        width: '100%',
      }}
    >
      {/* Full-bleed crosshatch: breaks out of the page's max-width column so the
          hatched texture spans the entire viewport width. */}
      <div
        aria-hidden="true"
        style={{
          ...crosshatch,
          position: 'absolute',
          top: '0',
          bottom: '0',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '100%',
          'pointer-events': 'none',
          'z-index': 0,
        }}
      />
      <div
        style={{
          display: 'grid',
          'justify-items': mobile() ? 'center' : 'start',
          position: 'relative',
          'text-align': mobile() ? 'center' : 'left',
          'z-index': 1,
        }}
      >
        <p
          style={{
            color: 'var(--c4)',
            'font-size': mobile() ? '16px' : '18px',
            'line-height': 1.35,
            margin: 0,
            'max-width': '520px',
          }}
        >
          Enterprise-grade security. Zero data retention (ZDR, no training) with
          model providers. SOC 2 Type II certified.
        </p>
      </div>
      <div
        aria-label="Security certifications"
        style={{
          'align-items': 'center',
          color: 'color-mix(in srgb, var(--c2) 78%, var(--c4))',
          display: 'flex',
          gap: mobile() ? '20px' : '28px',
          'justify-content': mobile() ? 'center' : 'end',
          opacity: 0.78,
          position: 'relative',
          'z-index': 1,
        }}
      >
        <IconIso
          aria-label="ISO 27001"
          style={{
            height: mobile() ? '48px' : '60px',
            width: mobile() ? '48px' : '60px',
          }}
        />
        <IconSoc2
          aria-label="AICPA SOC 2"
          style={{
            height: mobile() ? '48px' : '60px',
            width: mobile() ? '48px' : '60px',
          }}
        />
        <IconCasa
          aria-label="CASA Tier 2"
          style={{
            height: mobile() ? '48px' : '60px',
            transform: 'scale(1.02)',
            width: mobile() ? '48px' : '60px',
          }}
        />
      </div>
    </section>
  );
}
