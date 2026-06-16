import {
  openAddInboxDialog,
  useAddInboxGate,
} from '@app/component/AddInboxDialog';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { ENABLE_MULTI_INBOX_OVERRIDE } from '@core/constant/featureFlags';
import { useSettingsState } from '@core/constant/SettingsState';
import { Combobox } from '@kobalte/core/combobox';
import CaretDownIcon from '@phosphor/caret-down.svg';
import PlusIcon from '@phosphor/plus.svg';
import TrayIcon from '@phosphor/tray.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { useInboxPicker } from './inbox-picker';
import { SearchableMultiSelect } from './searchable-multi-select';

/**
 * Scopes the list to a subset of the user's linked inboxes. Multi-select,
 * default = all (no clause). Shown whenever the multi-inbox flag is on (or
 * the user already has multiple inboxes) so the "Add inbox" action row is
 * discoverable even with zero or one inbox connected. Selection is held in
 * soup-view's `inboxFilter` and compiled into `Owner` email literals.
 */
export function InboxSelector() {
  const { inboxFilter, setInboxFilter } = useSoupView();
  const picker = useInboxPicker({
    selectedIds: inboxFilter,
    setSelectedIds: setInboxFilter,
  });
  const multiInboxFlag = useFeatureFlag('enable-multi-inbox', {
    enabledOverride: ENABLE_MULTI_INBOX_OVERRIDE,
  });
  const { openSettings } = useSettingsState();
  const guardAddInbox = useAddInboxGate();

  const label = () => {
    const ids = inboxFilter();
    if (ids === undefined) return 'All inboxes';
    if (ids.length === 0) return 'No inboxes';
    if (ids.length === 1)
      return picker.options().find((o) => o.id === ids[0])?.label ?? '1 inbox';
    return `${ids.length} inboxes`;
  };

  return (
    <Show when={multiInboxFlag().enabled || picker.hasMultiple()}>
      <SearchableMultiSelect
        options={picker.options}
        activeIds={picker.activeIds}
        onChange={(ids) => (ids.length ? picker.onChange(ids) : picker.reset())}
        onOnly={picker.selectOnly}
        placeholder="Search inboxes..."
        preserveOrder
        action={
          multiInboxFlag().enabled
            ? {
                label: 'Add inbox',
                icon: () => <PlusIcon class="size-4" />,
                onSelect: () =>
                  guardAddInbox(() => {
                    openSettings('Email');
                    openAddInboxDialog();
                  }),
              }
            : undefined
        }
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
