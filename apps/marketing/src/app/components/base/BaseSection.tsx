import type { JSX } from 'solid-js';
import { breakpoint } from '../../utils/utilBreakpoint';

interface SectionProps {
  scene: JSX.Element;
  title: JSX.Element;
  body: JSX.Element;
  left?: boolean;
}

export function BaseSection(props: SectionProps) {
  const isLeft = () => props.left !== false;

  return (
    <div
      style={{
        'grid-template-areas': breakpoint()
          ? '"scene" "space" "text"'
          : isLeft()
            ? '"text space scene"'
            : '"scene space text"',
        'grid-template-columns': breakpoint()
          ? '1fr'
          : isLeft()
            ? '400px 1fr 500px'
            : '500px 1fr 400px',
        gap: breakpoint() ? '10px' : '20px',
        'align-items': 'start',
        display: 'grid',
      }}
    >
      <div
        style={{
          'align-self': 'center',
          'grid-area': 'text',
          display: 'grid',
          gap: '20px',
        }}
      >
        <h2
          style={{
            'line-height': breakpoint() ? '22px' : '32px',
            'font-size': breakpoint() ? '20px' : '30px',
            'letter-spacing': '-0.02em',
            'font-family': 'display',
            'font-weight': '450',
            margin: '0',
          }}
        >
          {props.title}
        </h2>
        <div
          style={{
            'line-height': breakpoint() ? '20px' : '24px',
            'font-size': breakpoint() ? '18px' : '20px',
            color: 'var(--c4)',
          }}
        >
          {props.body}
        </div>
      </div>

      <div style={{ 'grid-area': 'space' }} />

      <div
        style={{
          'grid-area': 'scene',
          width: '100%',
        }}
      >
        {props.scene}
      </div>
    </div>
  );
}
