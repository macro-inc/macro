import { t } from '@app/lib/i18n';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';

/** The row under Search's best matches that lists its other matching chats in place. */
export function SearchMoreChats(props: { count: number; onShow: () => void }) {
  return (
    <button
      type="button"
      class="mx-(--soup-row-gutter) flex min-h-10 w-[calc(100%-0.5rem)] items-center gap-2.5 rounded-xl px-2 text-left text-sm text-ink-muted not-touch:hover:bg-list-hover touch:min-h-11"
      onClick={() => props.onShow()}
    >
      <CaretDownIcon class="size-4 shrink-0" />
      <span class="truncate">
        {t('searchResults.moreChats', { count: props.count })}
      </span>
    </button>
  );
}
