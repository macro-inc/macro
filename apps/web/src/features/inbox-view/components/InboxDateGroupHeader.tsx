import type { SoupGroupHeaderRow } from '@app/features/soup';
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
            'mx-0 w-full',
            'pl-(--soup-row-padding-l)',
            !props.isFirst && 'pt-5'
          )}
        >
          <span class="truncate">{props.row.label}</span>
        </div>
      </div>
    </div>
  );
}
