import type { ComposerDragBounds } from '../../../core/composer-drag';

/** Preview the future dock without reserving space or moving the calendar. */
export function ComposerDropTarget(props: {
  bounds: ComposerDragBounds;
  active: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      data-composer-drop-target=""
      data-active={props.active || undefined}
      class="pointer-events-none fixed z-modal rounded-xl border-2 border-accent/40 bg-accent/5"
      classList={{ 'border-accent! bg-accent/15!': props.active }}
      style={{
        left: `${props.bounds.left}px`,
        top: `${props.bounds.top}px`,
        width: `${props.bounds.width}px`,
        height: `${props.bounds.height}px`,
      }}
    />
  );
}
