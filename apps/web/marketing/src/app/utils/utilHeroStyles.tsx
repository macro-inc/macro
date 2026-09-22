import type { JSX } from 'solid-js';

/** Inner faux-app chrome (title bars, tool rails) inside hero window mocks. */
export const heroAppChromeBg = 'var(--hero-app-chrome-bg)';

const heroFrameStyle: JSX.CSSProperties = {
  'background-color': 'color-mix(in srgb, var(--b1) 72%, var(--b0))',
  border: '1px solid color-mix(in srgb, var(--b4) 22%, transparent)',
  'box-shadow': 'var(--shadow-frame)',
  'box-sizing': 'border-box',
  overflow: 'hidden',
};

const heroFrameStripeStyle: JSX.CSSProperties = {
  'background-image':
    'repeating-linear-gradient(315deg, var(--b2) 0, var(--b2) 1px, transparent 0, transparent 50%)',
  'background-size': '12px 12px',
  inset: '0',
  opacity: '0.45',
  'pointer-events': 'none',
  position: 'absolute',
};

export function HeroBackdrop() {
  return (
    <div
      aria-hidden="true"
      style={{
        background:
          'radial-gradient(75% 55% at 50% 0%, color-mix(in srgb, var(--ambient-ink) 14%, transparent), transparent 70%)',
        inset: '0',
        'pointer-events': 'none',
        position: 'absolute',
        'z-index': 0,
      }}
    />
  );
}

export function HeroFrame(props: {
  children: JSX.Element;
  mobile?: boolean;
  width?: string;
  /** Skip inner padding when content manages its own inset. */
  bare?: boolean;
}) {
  const radius = () => (props.mobile ? '20px' : '24px');
  return (
    <div
      style={{
        ...heroFrameStyle,
        'border-radius': radius(),
        position: 'relative',
        width: props.width ?? 'min(100%, 1060px)',
        'z-index': 1,
      }}
    >
      <div aria-hidden="true" style={heroFrameStripeStyle} />
      <div
        style={
          props.bare
            ? { position: 'relative', 'z-index': 1 }
            : {
                padding: props.mobile ? '12px' : '16px',
                position: 'relative',
                'z-index': 1,
              }
        }
      >
        {props.children}
      </div>
    </div>
  );
}
