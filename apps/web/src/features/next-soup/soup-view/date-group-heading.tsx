import { SOUP_ROW_CLASS } from '@entity/composed/list-entity/row-geometry';
import { useListLayout } from '@entity/composed/list-entity/shared';
import { cn } from '@ui';
import { SoupSectionHeader } from './section-header';

/**
 * A date bucket's heading ("Today", "Last 7 days") among list rows, as the
 * email list draws it. Callers supply the row semantics around it.
 */
export function DateGroupHeading(props: { label: string; isFirst: boolean }) {
  const listLayout = useListLayout();

  // Take the geometry of the single-line rows this header sits among (they
  // split by container width off the same `isWide`), so the label starts
  // exactly where their content does — just past the unread/checkbox gutter.
  const geometryClass = () =>
    (listLayout?.isWide() ?? true)
      ? SOUP_ROW_CLASS.wide
      : SOUP_ROW_CLASS.narrow;

  return (
    <SoupSectionHeader
      class={cn(
        geometryClass(),
        'border-none my-0 bg-transparent text-ink-extra-muted/80',
        'mx-(--soup-row-gutter) w-[calc(100%-2*var(--soup-row-gutter))]',
        'pl-[calc(var(--soup-row-content-inset)-var(--soup-row-gutter))]',
        !props.isFirst && 'pt-5'
      )}
    >
      <span class="truncate">{props.label}</span>
    </SoupSectionHeader>
  );
}
