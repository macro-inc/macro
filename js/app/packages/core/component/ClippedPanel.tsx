import { cornerClip } from '@core/util/clipPath';
import { createMemo, splitProps, type JSX } from 'solid-js';
import { beveledCorners } from '../signal/beveledCorners';
import { cn } from '@ui/utils/classname';

export type ClippedPanelProps = JSX.HTMLAttributes<HTMLDivElement> & {
  active?: boolean;
  edgeColor?: JSX.CSSProperties['color'];
  highlightColor?: JSX.CSSProperties['color'];
  /**
   * When provided, this overrides all corner behavior:
   * - bypasses clip-path (no corner clipping)
   * - bypasses beveled corner logic (no signal check)
   * - sets a uniform border-radius on both wrapper and inner panel
   */
  cornerRadius?: JSX.CSSProperties['border-radius'];
  tr?: boolean;
  tl?: boolean;
  bl?: boolean;
  br?: boolean;
};

export function ClippedPanel(props: ClippedPanelProps) {
  const [local, rest] = splitProps(props, [
    'active',
    'edgeColor',
    'highlightColor',
    'cornerRadius',
    'tr',
    'tl',
    'br',
    'bl',
    'children',
    'class',
  ]);

  const outerBgImage = createMemo(() => {
    const edge = local.edgeColor || 'var(--color-edge-muted)';
    const hl = local.highlightColor || 'var(--color-accent)';
    return `linear-gradient(${local.active ? `${hl}, ${edge} 80%` : edge} )`;
  });

  const useCornerRadiusOverride = createMemo(() => local.cornerRadius != null);

  const clipEnabled = createMemo(() => {
    if (useCornerRadiusOverride()) return false;
    return !beveledCorners();
  });

  const outerClipPath = createMemo(() => {
    if (!clipEnabled()) return '';
    return cornerClip(
      local.tl ? '0.5rem' : 0,
      local.tr ? '0.5rem' : 0,
      local.br ? '0.5rem' : 0,
      local.bl ? '0.5rem' : 0
    );
  });

  const innerClipPath = createMemo(() => {
    if (!clipEnabled()) return '';
    return cornerClip(
      local.tl ? 'calc(0.5rem - 0.5px)' : 0,
      local.tr ? 'calc(0.5rem - 0.5px)' : 0,
      local.br ? 'calc(0.5rem - 0.5px)' : 0,
      local.bl ? 'calc(0.5rem - 0.5px)' : 0
    );
  });

  const outerBorderRadius = createMemo(() => {
    if (useCornerRadiusOverride()) return local.cornerRadius;
    if (!beveledCorners()) return '0';
    return `
            ${local.tl ? '16px' : '4px'}
            ${local.tr ? '16px' : '4px'}
            ${local.br ? '16px' : '4px'}
            ${local.bl ? '16px' : '4px'}
          `;
  });

  const innerBorderRadius = createMemo(() => {
    if (useCornerRadiusOverride()) return `calc(${local.cornerRadius} - 0.5px)`;
    if (!beveledCorners()) return '0';
    return `
              ${local.tl ? '15.5px' : '3.3px'}
              ${local.tr ? '15.5px' : '3.3px'}
              ${local.br ? '15.5px' : '3.3px'}
              ${local.bl ? '15.5px' : '3.3px'}
            `;
  });

  return (
    <div
      style={{
        'background-image': outerBgImage(),
        'clip-path': outerClipPath(),
        'border-radius': outerBorderRadius(),
      }}
      class="p-px h-full w-full box-border"
    >
      <div
        style={{
          'clip-path': innerClipPath(),
          'border-radius': innerBorderRadius(),
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
