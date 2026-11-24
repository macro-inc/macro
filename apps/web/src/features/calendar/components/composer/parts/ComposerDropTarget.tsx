import { t } from '@app/lib/i18n';
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
      class="pointer-events-none fixed z-modal flex items-center justify-center rounded-xl border-2 border-dashed border-border-secondary bg-surface text-sm text-ink-muted"
      classList={{ 'border-accent! bg-selected!': props.active }}
      style={{
        left: `${props.bounds.left}px`,
        top: `${props.bounds.top}px`,
        width: `${props.bounds.width}px`,
        height: `${props.bounds.height}px`,
      }}
    >
      {t('calendar.pinHere')}
    </div>
  );
}
