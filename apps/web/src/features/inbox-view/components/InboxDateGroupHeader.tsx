import type { SoupGroupHeaderRow } from '@app/features/soup';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { SOUP_ROW_CLASS } from '@entity/composed/list-entity/row-geometry';
import { cn } from '@ui';

export function InboxDateGroupHeader(props: {
  row: SoupGroupHeaderRow;
  isFirst: boolean;
}) {
  return (
    <div id={props.row.id} role="row">
      <div role="gridcell">
        <div
          class={cn(
            SOUP_ROW_CLASS.card,
            'group/header relative flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs font-semibold tracking-tight',
            'border-none my-0 text-ink-extra-muted/80',
            // Touch takes the legacy card-row gutters so the label starts
            // where InboxListEntity content does; desktop keeps the Home form.
            isTouchDevice()
              ? 'mx-(--soup-row-gutter) w-[calc(100%-2*var(--soup-row-gutter))] pl-[calc(var(--soup-row-content-inset)-var(--soup-row-gutter))]'
              : 'mx-0 w-full px-4',
            !props.isFirst && 'pt-5'
          )}
        >
          <span class="truncate">{props.row.label}</span>
        </div>
      </div>
    </div>
  );
}
