import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { Combobox } from '@kobalte/core/combobox';
import CaretDownIcon from '@phosphor/caret-down.svg';
import TrayIcon from '@phosphor/tray.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { useInboxPicker } from './inbox-picker';
import { SearchableMultiSelect } from './searchable-multi-select';

/**
 * Scopes the list to a subset of the user's linked inboxes. Multi-select,
 * default = all (no clause). Hidden entirely for single-inbox users so they
 * see no change. Selection is held in soup-view's `inboxFilter` and compiled
 * into `Owner` email literals.
 */
export function InboxSelector() {
  const { inboxFilter, setInboxFilter } = useSoupView();
  const picker = useInboxPicker({
    selectedIds: inboxFilter,
    setSelectedIds: setInboxFilter,
  });

  const label = () => {
    const ids = inboxFilter();
    if (ids === undefined) return 'All inboxes';
    if (ids.length === 0) return 'No inboxes';
    if (ids.length === 1)
      return picker.options().find((o) => o.id === ids[0])?.label ?? '1 inbox';
    return `${ids.length} inboxes`;
  };

  return (
    <Show when={picker.hasMultiple()}>
      <SearchableMultiSelect
        options={picker.options}
        activeIds={picker.activeIds}
        onChange={picker.onChange}
        onOnly={picker.selectOnly}
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
