import type { GroupHeaderProps } from '@app/features/next-soup/create-soup-state';
import { SoupSectionHeader } from '@app/features/next-soup/soup-view/section-header';
import { SOUP_ROW_CLASS } from '@entity/composed/list-entity/row-geometry';
import { useListLayout } from '@entity/composed/list-entity/shared';
import { cn } from '@ui';

export const DateGroupHeader = (props: GroupHeaderProps) => {
  const listLayout = useListLayout();

  // Take the geometry of the rows this header sits among: `card` has one form,
  // `row` splits by container width off the same `isWide` its rows read.
  const geometryClass = () => {
    if (props.rowFamily === 'card') return SOUP_ROW_CLASS.card;
    return (listLayout?.isWide() ?? true)
      ? SOUP_ROW_CLASS.wide
      : SOUP_ROW_CLASS.narrow;
  };

  return (
    <SoupSectionHeader
      highlighted={props.highlighted}
      class={cn(
        // Take the geometry of the rows this header sits among, so the label
        // starts exactly where their content does — just past the
        // unread/checkbox gutter — in every soup view.
        geometryClass(),
        'border-none my-0 bg-panel text-ink-extra-muted/80',
        'mx-(--soup-row-gutter) w-[calc(100%-2*var(--soup-row-gutter))]',
        'pl-[calc(var(--soup-row-content-inset)-var(--soup-row-gutter))]',
        !props.isFirst && 'pt-5'
      )}
    >
      <span class="truncate">{props.group.label}</span>
    </SoupSectionHeader>
  );
};
