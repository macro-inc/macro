import { cornerClip } from '@core/util/clipPath';
import type { JSXElement } from 'solid-js';
import { beveledCorners } from '../../block-theme/signals/themeSignals';

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
        'background-image': `linear-gradient(var(--color-accent), var(--color-edge-muted) ${props.active ? '80%' : '0%'})`,
        'clip-path': !beveledCorners()
          ? cornerClip(
              props.tl ? '0.5rem' : 0,
              props.tr ? '0.5rem' : 0,
              props.br ? '0.5rem' : 0,
              props.bl ? '0.5rem' : 0
            )
          : '',
        'border-radius': beveledCorners()
          ? `
          ${props.tl ? '16px' : '4px'}
          ${props.tr ? '16px' : '4px'}
          ${props.br ? '16px' : '4px'}
          ${props.bl ? '16px' : '4px'}
        `
          : '0',
      }}
      class="p-px h-full w-full box-border"
    >
      <div
        style={{
          'clip-path': !beveledCorners()
            ? cornerClip(
                props.tl ? 'calc(0.5rem - 0.5px)' : 0,
                props.tr ? 'calc(0.5rem - 0.5px)' : 0,
                props.br ? 'calc(0.5rem - 0.5px)' : 0,
                props.bl ? 'calc(0.5rem - 0.5px)' : 0
              )
            : '',
          'border-radius': beveledCorners()
            ? `
            ${props.tl ? '15.5px' : '3.3px'}
            ${props.tr ? '15.5px' : '3.3px'}
            ${props.br ? '15.5px' : '3.3px'}
            ${props.bl ? '15.5px' : '3.3px'}
          `
            : '0',
        }}
        class="h-full w-full box-border overflow-hidden bg-panel"
      >
        {props.children}
      </div>
    </div>
  );
}
