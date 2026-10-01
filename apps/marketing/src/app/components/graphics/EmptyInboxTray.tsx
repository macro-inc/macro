import type { JSX } from 'solid-js';
import EmptyTrayGraphic from '../../../assets/graphics/empty-state-inbox-tray.svg';
import { INK } from './EmailListCardGraphic';

// The app's inbox-zero tray, ported from the Macro product (packages/design/
// empty-state-inbox-tray.svg): an isometric tray whose entrance animation is
// embedded in the SVG itself — the tray drops in, then the dashed outline
// fades up, both honoring prefers-reduced-motion. The animation runs when the
// SVG mounts, so remount the component (e.g. via a keyed <Show>) to replay it.
//
// Two hooks the SVG expects from its host, both handled here:
// - strokes draw with currentColor -> `color` sets the line work
// - the tray's front faces fill with var(--color-surface) -> `surface` must
//   match the panel behind it, or the faces render transparent and the back
//   edges show through the silhouette
export function EmptyInboxTray(props: {
  /** CSS width; the graphic keeps its own aspect ratio. Default 150px. */
  width?: number | string;
  /** Stroke color for the line work. Defaults to the card palette's muted text. */
  color?: string;
  /** Backing surface color for the tray faces. Defaults to the card background. */
  surface?: string;
  style?: JSX.CSSProperties;
}) {
  return (
    <div
      aria-hidden="true"
      style={{
        'aspect-ratio': '38.6 / 24.77',
        color: props.color ?? INK.textMuted,
        '--color-surface': props.surface ?? INK.bg,
        position: 'relative',
        width:
          typeof props.width === 'number'
            ? `${props.width}px`
            : (props.width ?? '150px'),
        ...props.style,
      }}
    >
      <EmptyTrayGraphic />
    </div>
  );
}
