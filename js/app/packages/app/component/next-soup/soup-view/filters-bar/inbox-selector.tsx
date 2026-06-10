import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { inboxIconProps } from '@core/component/inboxIcon';
import { UserIcon } from '@core/component/UserIcon';
import { Combobox } from '@kobalte/core/combobox';
import CaretDownIcon from '@phosphor/caret-down.svg';
import TrayIcon from '@phosphor/tray.svg';
import { useEmailLinksQuery } from '@queries/email/link';
import { Button } from '@ui';
import { createMemo, Show } from 'solid-js';
import {
  SearchableMultiSelect,
  type SearchableOption,
} from './searchable-multi-select';

/**
 * Scopes the list to a subset of the user's linked inboxes. Multi-select,
 * default = all (no clause). Hidden entirely for single-inbox users so they
 * see no change. Selection is held in soup-view's `inboxFilter` and compiled
 * into `Owner` email literals.
 */
export function InboxSelector() {
  const linksQuery = useEmailLinksQuery();
  const links = () => linksQuery.data?.links ?? [];
  const { inboxFilter, setInboxFilter } = useSoupView();

  const options = createMemo((): SearchableOption[] =>
    links()
      .map((link) => ({
        id: link.id,
        label: link.email_address,
        icon: () => (
          <UserIcon
            {...inboxIconProps(link.email_address)}
            photoUrl={link.photo_url ?? undefined}
            size="sm"
            suppressClick
            showTooltip={false}
          />
        ),
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  );

  const activeIds = createMemo(() => {
    const selected = inboxFilter();
    return selected === undefined ? links().map((l) => l.id) : selected;
  });

  const onChange = (ids: string[]) =>
    setInboxFilter(ids.length === links().length ? undefined : ids);

  const label = () => {
    const ids = inboxFilter();
    if (ids === undefined) return 'All inboxes';
    if (ids.length === 0) return 'No inboxes';
    if (ids.length === 1)
      return links().find((l) => l.id === ids[0])?.email_address ?? '1 inbox';
    return `${ids.length} inboxes`;
  };

  return (
    <Show when={links().length > 1}>
      <SearchableMultiSelect
        options={options}
        activeIds={activeIds}
        onChange={onChange}
        placeholder="Search inboxes..."
        preserveOrder
      >
        <Combobox.Trigger
          as={Button}
          variant="base"
          size="sm"
          depth={2}
          class="bg-surface gap-1 max-w-50"
        >
          <TrayIcon />
          <span class="truncate">{label()}</span>
          <CaretDownIcon class="size-3 shrink-0" />
        </Combobox.Trigger>
      </SearchableMultiSelect>
    </Show>
  );
}
