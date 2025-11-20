import { cornerClip } from '@core/util/clipPath';
import type { JSXElement } from 'solid-js';

interface PanelProps {
  children?: JSXElement;
  active?: boolean;
  tr?: boolean;
  tl?: boolean;
  bl?: boolean;
  br?: boolean;
}

export function ClippedPanel(props: PanelProps) {
  return (
    <div
      style={{
        'background-image': `linear-gradient(${props.active ? 'var(--color-accent)' : 'var(--color-edge-muted)'}, var(--color-edge-muted))`,
        'box-sizing': 'border-box',
        'clip-path': cornerClip(
          props.tl ? '0.5rem' : 0,
          props.tr ? '0.5rem' : 0,
          props.br ? '0.5rem' : 0,
          props.bl ? '0.5rem' : 0
        ),
        padding: '1px',
        height: '100%',
        width: '100%',
      }}
    >
      <div
        style={{
          'background-color': 'var(--color-panel)',
          'box-sizing': 'border-box',
          'clip-path': cornerClip(
            props.tl ? 'calc(0.5rem - 0.5px)' : 0,
            props.tr ? 'calc(0.5rem - 0.5px)' : 0,
            props.br ? 'calc(0.5rem - 0.5px)' : 0,
            props.bl ? 'calc(0.5rem - 0.5px)' : 0
          ),
          height: '100%',
          width: '100%',
        }}
      >
        {props.children}
      </div>
    </div>
  );
}
