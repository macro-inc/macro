import { cornerClip } from '@core/util/clipPath';
import { splitProps, type JSX } from 'solid-js';
import { beveledCorners } from '../../block-theme/signals/themeSignals';
import { cn } from '@ui/utils/classname';

type PanelProps = JSX.HTMLAttributes<HTMLDivElement> & {
  active?: boolean;
  edgeColor?: JSX.CSSProperties['color'];
  tr?: boolean;
  tl?: boolean;
  bl?: boolean;
  br?: boolean;
};

export function ClippedPanel(props: PanelProps) {
  const [local, rest] = splitProps(props, [
    'active',
    'edgeColor',
    'tr',
    'tl',
    'br',
    'bl',
    'children',
    'class',
  ]);
  return (
    <div
      style={{
        'background-image': `linear-gradient(${local.active ? `var(--color-accent), ${local.edgeColor || 'var(--color-edge-muted)'} 80%` : `${local.edgeColor || 'var(--color-edge-muted)'}`} )`,
        'clip-path': !beveledCorners()
          ? cornerClip(
              local.tl ? '0.5rem' : 0,
              local.tr ? '0.5rem' : 0,
              local.br ? '0.5rem' : 0,
              local.bl ? '0.5rem' : 0
            )
          : '',
        'border-radius': beveledCorners()
          ? `
            ${local.tl ? '16px' : '4px'}
            ${local.tr ? '16px' : '4px'}
            ${local.br ? '16px' : '4px'}
            ${local.bl ? '16px' : '4px'}
          `
          : '0',
      }}
      class="p-px h-full w-full box-border"
    >
      <div
        style={{
          'clip-path': !beveledCorners()
            ? cornerClip(
                local.tl ? 'calc(0.5rem - 0.5px)' : 0,
                local.tr ? 'calc(0.5rem - 0.5px)' : 0,
                local.br ? 'calc(0.5rem - 0.5px)' : 0,
                local.bl ? 'calc(0.5rem - 0.5px)' : 0
              )
            : '',
          'border-radius': beveledCorners()
            ? `
              ${local.tl ? '15.5px' : '3.3px'}
              ${local.tr ? '15.5px' : '3.3px'}
              ${local.br ? '15.5px' : '3.3px'}
              ${local.bl ? '15.5px' : '3.3px'}
            `
            : '0',
        }}
        class={cn(
          'h-full w-full box-border overflow-hidden bg-panel',
          local.class
        )}
        {...rest}
      >
        {local.children}
      </div>
    </div>
  );
}
