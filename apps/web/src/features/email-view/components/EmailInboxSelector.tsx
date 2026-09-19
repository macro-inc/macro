import { useInboxPicker } from '@app/features/next-soup/soup-view/filters-bar/inbox-picker';
import { SearchableMultiSelect } from '@app/features/next-soup/soup-view/filters-bar/searchable-multi-select';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableMultiInbox } from '@core/constant/featureFlags';
import { useAddInboxFlow } from '@core/email-link';
import { Combobox } from '@kobalte/core/combobox';
import CaretDownIcon from '@phosphor/caret-down.svg';
import PlusIcon from '@phosphor/plus.svg';
import TrayIcon from '@phosphor/tray.svg';
import { Button, cn } from '@ui';
import { Show } from 'solid-js';
import { useEmailView } from '../email-view-context';

export type EmailInboxSelectorProps = {
  /**
   * `sidebar` is the full-width row at the top of the Email sidebar;
   * `compact` is the icon-only trigger the narrow header falls back to when
   * the sidebar is collapsed.
   */
  variant?: 'sidebar' | 'compact';
  class?: string;
};

/**
 * Scopes the list to a subset of the user's linked inboxes. Multi-select,
 * default = all. Shown whenever the multi-inbox flag is on (or the user
 * already has multiple inboxes); with a single inbox it names the account
 * and offers "Connect another account" inside the menu.
 */
export function EmailInboxSelector(props: EmailInboxSelectorProps) {
  const { state, setInboxIds } = useEmailView();
  const picker = useInboxPicker({
    selectedIds: () => state.inboxIds,
    setSelectedIds: setInboxIds,
  });
  const multiInboxFlag = useFeatureFlag(enableMultiInbox);
  const addInbox = useAddInboxFlow();

  const soleActiveInbox = () => {
    const ids = picker.activeIds();
    if (ids.length !== 1) return undefined;

    return picker.options().find((option) => option.id === ids[0]);
  };

  const label = () => {
    const sole = soleActiveInbox();
    if (sole) return sole.label;

    const ids = state.inboxIds;
    if (ids === undefined) return 'All inboxes';
    if (ids.length === 0) return 'No inboxes';
    // A lone id that no longer resolves to a linked inbox still reads as one.
    if (ids.length === 1) return '1 inbox';
    return `${ids.length} inboxes`;
  };

  const compact = () => props.variant === 'compact';

  return (
    <Show when={multiInboxFlag().enabled || picker.hasMultiple()}>
      <SearchableMultiSelect
        options={picker.options}
        activeIds={picker.activeIds}
        onChange={(ids) => (ids.length ? picker.onChange(ids) : picker.reset())}
        onOnly={picker.selectOnly}
        placeholder="Search inboxes..."
        placement="bottom-start"
        preserveOrder
        action={
          multiInboxFlag().enabled
            ? {
                label: 'Connect another account',
                icon: () => <PlusIcon class="size-4" />,
                onSelect: () => void addInbox(),
              }
            : undefined
        }
      >
        <Combobox.Trigger
          as={Button}
          variant={compact() ? 'ghost' : 'outline'}
          size={compact() ? 'sm' : 'md'}
          square={compact()}
          depth={2}
          aria-label={`Inbox: ${label()}`}
          tooltip={compact() ? label() : undefined}
          class={cn(
            compact()
              ? 'size-8 shrink-0 rounded-full'
              : 'h-9 w-full min-w-0 justify-start gap-2.5 rounded-xl bg-surface px-3 font-medium',
            props.class
          )}
        >
          <Show
            when={soleActiveInbox()?.icon}
            fallback={<TrayIcon aria-hidden="true" class="size-4 shrink-0" />}
          >
            {(icon) => icon()()}
          </Show>
          <Show when={!compact()}>
            <span class="min-w-0 flex-1 truncate text-left">{label()}</span>
            <CaretDownIcon
              aria-hidden="true"
              class="size-3 shrink-0 text-ink-extra-muted"
            />
          </Show>
        </Combobox.Trigger>
      </SearchableMultiSelect>
    </Show>
  );
}
