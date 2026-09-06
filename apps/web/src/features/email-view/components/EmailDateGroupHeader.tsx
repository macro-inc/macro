import { SoupSectionHeader } from '@app/features/next-soup/soup-view/section-header';
import type { SoupGroupHeaderRow } from '@app/features/soup';
import { SOUP_ROW_CLASS } from '@entity/composed/list-entity/row-geometry';
import { useListLayout } from '@entity/composed/list-entity/shared';
import { cn } from '@ui';

export function EmailDateGroupHeader(props: {
  row: SoupGroupHeaderRow;
  isFirst: boolean;
}) {
  const listLayout = useListLayout();

  // Take the geometry of the single-line rows this header sits among (they
  // split by container width off the same `isWide`), so the label starts
  // exactly where their content does — just past the unread/checkbox gutter.
  const geometryClass = () =>
    (listLayout?.isWide() ?? true)
      ? SOUP_ROW_CLASS.wide
      : SOUP_ROW_CLASS.narrow;

  return (
    <div id={props.row.id} role="row">
      <div role="gridcell">
        <SoupSectionHeader
          class={cn(
            geometryClass(),
            'border-none my-0 bg-transparent text-ink-extra-muted/80',
            'mx-(--soup-row-gutter) w-[calc(100%-2*var(--soup-row-gutter))]',
            'pl-[calc(var(--soup-row-content-inset)-var(--soup-row-gutter))]',
            !props.isFirst && 'pt-5'
          )}
        >
          <span class="truncate">{props.row.label}</span>
        </SoupSectionHeader>
      </div>
    </div>
  );
}
