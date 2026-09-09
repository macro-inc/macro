import { MobileFilterDrawer } from '@app/components/view-shell/MobileFilterDrawer';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { Accordion } from '@kobalte/core/accordion';
import { batch, For } from 'solid-js';
import { useEmailView } from '../email-view-context';
import { useEmailFilters } from '../filters/use-email-filters';
import { EmailInboxSelector } from './EmailInboxSelector';

export function EmailFilterDrawer() {
  const { state, setInboxIds } = useEmailView();
  const filters = useEmailFilters();

  return (
    <MobileFilterDrawer
      triggerLabel="Open email filters"
      label="Email filters"
      activeCount={
        filters.activeCount() + (state.inboxIds === undefined ? 0 : 1)
      }
      onClear={() =>
        batch(() => {
          filters.clear();
          setInboxIds(undefined);
        })
      }
    >
      <MobileDrawer.Label class="pt-4">Filters</MobileDrawer.Label>
      <div class="px-3 pb-3 empty:hidden">
        <EmailInboxSelector />
      </div>
      <Accordion multiple collapsible defaultValue={[filters.groups[0].id]}>
        <div class="flex flex-col gap-3">
          <For each={filters.groups}>
            {(group) => (
              <MobileFilterDrawer.Section
                value={group.id}
                label={group.label}
                activeCount={state.facets[group.id]?.length ?? 0}
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
                        checked={filters.isSelected(group.id, option.id)}
                        onChange={(checked) =>
                          filters.setSelected(group.id, option.id, checked)
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
