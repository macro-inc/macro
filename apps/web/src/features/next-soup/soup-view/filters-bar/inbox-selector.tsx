import { useSoupView } from '@app/features/next-soup/soup-view/soup-view-context';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { CollapsibleHeaderItem } from '@components/app/split-layout/components/CollapsibleItem';
import { enableMultiInbox } from '@core/constant/featureFlags';
import { useAddInboxFlow } from '@core/email-link';
import { Combobox } from '@kobalte/core/combobox';
import CaretDownIcon from '@phosphor/caret-down.svg';
import PlusIcon from '@phosphor/plus.svg';
import TrayIcon from '@phosphor/tray.svg';
import { Button, cn } from '@ui';
import { Show } from 'solid-js';
import { useInboxPicker } from './inbox-picker';
import { SearchableMultiSelect } from './searchable-multi-select';

/**
 * Scopes the list to a subset of the user's linked inboxes. Multi-select,
 * default = all (no clause). Shown whenever the multi-inbox flag is on (or
 * the user already has multiple inboxes). With exactly one inbox connected
 * there is nothing to filter, so the dropdown is replaced by a "Connect
 * another account" button that jumps straight into the add-inbox flow.
 * Selection is held in soup-view's `inboxFilter` and compiled into `Owner`
 * email literals.
 */
export function InboxSelector() {
  const { inboxFilter, setInboxFilter } = useSoupView();
  const picker = useInboxPicker({
    selectedIds: inboxFilter,
    setSelectedIds: setInboxFilter,
  });
  const multiInboxFlag = useFeatureFlag(enableMultiInbox);
  const addInbox = useAddInboxFlow();

  const label = () => {
    const ids = inboxFilter();
    if (ids === undefined) return 'All inboxes';
    if (ids.length === 0) return 'No inboxes';
    if (ids.length === 1)
      return picker.options().find((o) => o.id === ids[0])?.label ?? '1 inbox';
    return `${ids.length} inboxes`;
  };

  const Selector = (selectorProps: { hideLabel?: boolean }) => (
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
              label: 'Connect another account',
              icon: () => <PlusIcon class="size-4" />,
              onSelect: () => addInbox(),
            }
          : undefined
      }
    >
      <Combobox.Trigger
        as={Button}
        variant="outline"
        size="sm"
        depth={2}
        aria-label={selectorProps.hideLabel ? label() : undefined}
        class={cn(
          'bg-surface gap-1',
          selectorProps.hideLabel ? 'px-1' : 'max-w-50'
        )}
      >
        <TrayIcon />
        <Show when={!selectorProps.hideLabel}>
          <span class="truncate">{label()}</span>
        </Show>
        <CaretDownIcon class="size-3 shrink-0" />
      </Combobox.Trigger>
    </SearchableMultiSelect>
  );

  const ConnectAnotherAccount = (buttonProps: { hideLabel?: boolean }) => (
    <Button
      variant="outline"
      size="sm"
      depth={2}
      aria-label={buttonProps.hideLabel ? 'Connect another account' : undefined}
      tooltip={buttonProps.hideLabel ? 'Connect another account' : undefined}
      class={cn('bg-surface gap-1', buttonProps.hideLabel && 'px-1')}
      onClick={() => addInbox()}
    >
      <TrayIcon />
      <Show when={!buttonProps.hideLabel}>
        <span class="truncate">Connect another account</span>
      </Show>
    </Button>
  );

  const showConnectButton = () =>
    multiInboxFlag().enabled && picker.options().length === 1;

  return (
    <Show when={multiInboxFlag().enabled || picker.hasMultiple()}>
      <CollapsibleHeaderItem
        id="inbox-selector"
        priority={3}
        containerClass="h-full"
      >
        {(isCollapsed) => (
          <Show
            when={showConnectButton()}
            fallback={<Selector hideLabel={isCollapsed()} />}
          >
            <ConnectAnotherAccount hideLabel={isCollapsed()} />
          </Show>
        )}
      </CollapsibleHeaderItem>
    </Show>
  );
}
