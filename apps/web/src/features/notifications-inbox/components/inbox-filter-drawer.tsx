import { MobileFilterDrawer } from '@app/components/view-shell';
import { Accordion } from '@kobalte/core/accordion';
import { For } from 'solid-js';
import type { InboxCategory, InboxStatus } from '../core/inbox-filters';
import {
  INBOX_FILTER_GROUPS,
  type InboxFilterOptionId,
  isStatusOption,
} from './inbox-filter-groups';

/** The touch counterpart of the filter menu: Status and Type in a sheet. */
export function InboxFilterDrawer(props: {
  status: InboxStatus;
  isShown: (category: InboxCategory) => boolean;
  activeCount: number;
  onStatusChange: (status: InboxStatus) => void;
  onShownChange: (category: InboxCategory, shown: boolean) => void;
  onReset: () => void;
}) {
  const isSelected = (option: InboxFilterOptionId) =>
    isStatusOption(option) ? props.status === option : props.isShown(option);

  return (
    <MobileFilterDrawer
      triggerLabel="Filter notifications"
      label="Notification filters"
      activeCount={props.activeCount}
      onClear={props.onReset}
    >
      <Accordion multiple collapsible defaultValue={['status', 'type']}>
        <div class="flex flex-col">
          <For each={INBOX_FILTER_GROUPS}>
            {(group) => (
              <MobileFilterDrawer.Section
                value={group.id}
                label={group.label}
                activeCount={
                  group.id === 'status'
                    ? props.status === 'all'
                      ? 0
                      : 1
                    : group.options.filter((option) => !isSelected(option.id))
                        .length
                }
                class="mb-3"
              >
                <div
                  role={
                    group.selectionMode === 'single' ? 'radiogroup' : 'group'
                  }
                  aria-label={group.label}
                >
                  <For each={group.options}>
                    {(option) => (
                      <MobileFilterDrawer.Option
                        selectionMode={group.selectionMode}
                        checked={isSelected(option.id)}
                        onChange={(checked) => {
                          const id = option.id;
                          if (isStatusOption(id)) props.onStatusChange(id);
                          else props.onShownChange(id, checked);
                        }}
                        icon={option.icon?.()}
                      >
                        {option.label}
                      </MobileFilterDrawer.Option>
                    )}
                  </For>
                </div>
              </MobileFilterDrawer.Section>
            )}
          </For>
        </div>
      </Accordion>
    </MobileFilterDrawer>
  );
}
