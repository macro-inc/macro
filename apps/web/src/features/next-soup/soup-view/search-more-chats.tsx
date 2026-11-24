import { t } from '@app/lib/i18n';
import {
  SOUP_ROW_CLASS,
  type SoupRowFamily,
} from '@entity/composed/list-entity/row-geometry';
import { useListLayout } from '@entity/composed/list-entity/shared';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import { cn } from '@ui';

/** The row under Search's best matches that lists its other matching chats in place. */
export function SearchMoreChats(props: {
  count: number;
  rowFamily: SoupRowFamily;
  onShow: () => void;
}) {
  const listLayout = useListLayout();
  // Lines its caret up with the icons of the rows it sits among.
  const geometryClass = () => {
    if (props.rowFamily === 'card') return SOUP_ROW_CLASS.card;
    return (listLayout?.isWide() ?? true)
      ? SOUP_ROW_CLASS.wide
      : SOUP_ROW_CLASS.narrow;
  };

  return (
    <button
      type="button"
      data-owns-enter
      data-press-surface
      class={cn(
        geometryClass(),
        'mx-(--soup-row-gutter) w-[calc(100%-2*var(--soup-row-gutter))]',
        'pl-[calc(var(--soup-row-content-inset)-var(--soup-row-gutter))]',
        'flex min-h-10 items-center gap-2 rounded-xl pr-2 text-left text-sm text-ink-muted not-touch:hover:bg-list-hover focus-visible:bg-list-hover touch:min-h-11'
      )}
      onClick={() => props.onShow()}
    >
      <CaretDownIcon class="size-4 shrink-0" />
      <span class="truncate">
        {t('searchResults.moreChats', { count: props.count })}
      </span>
    </button>
  );
}
