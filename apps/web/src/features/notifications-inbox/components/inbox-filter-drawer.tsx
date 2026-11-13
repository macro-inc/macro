import { MobileFilterDrawer } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import { Accordion } from '@kobalte/core/accordion';
import { ToggleSwitch } from '@ui';
import { For, Show } from 'solid-js';
import type { InboxCategory } from '../core/inbox-filters';
import { INBOX_FILTER_GROUPS } from './inbox-filter-groups';

/** The touch counterpart of the filter menu: Type in a sheet. */
export function InboxFilterDrawer(props: {
  isShown: (category: InboxCategory) => boolean;
  activeCount: number;
  onShownChange: (category: InboxCategory, shown: boolean) => void;
  onReset: () => void;
  /**
   * Only unread rows, as a switch above the kinds. Given once the pills are
   * lanes and no longer hold Unread.
   */
  unreadOnly?: { checked: boolean; onChange: (checked: boolean) => void };
}) {
  return (
    <MobileFilterDrawer
      triggerLabel={t('notificationsInbox.filter')}
      label={t('notificationsInbox.filters')}
      activeCount={props.activeCount}
      onClear={props.onReset}
    >
      <Show when={props.unreadOnly}>
        {(unreadOnly) => (
          <ToggleSwitch
            size="md"
            class="mb-3 flex min-h-11 w-full flex-row-reverse justify-between px-3 text-base text-ink"
            labelClass="min-w-0 flex-1"
            label={t('notificationsInbox.unreadOnly')}
            checked={unreadOnly().checked}
            onChange={unreadOnly().onChange}
          />
        )}
      </Show>
      <Accordion multiple collapsible defaultValue={['type']}>
        <div class="flex flex-col">
          <For each={INBOX_FILTER_GROUPS}>
            {(group) => (
              <MobileFilterDrawer.Section
                value={group.id}
                label={group.label}
                activeCount={props.activeCount}
                class="mb-3"
              >
                <div role="group" aria-label={group.label}>
                  <For each={group.options}>
                    {(option) => (
                      <MobileFilterDrawer.Option
                        selectionMode={group.selectionMode}
                        checked={props.isShown(option.id)}
                        onChange={(checked) =>
                          props.onShownChange(option.id, checked)
                        }
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
