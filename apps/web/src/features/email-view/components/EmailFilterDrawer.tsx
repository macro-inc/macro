import { MobileFilterDrawer } from '@app/components/view-shell/MobileFilterDrawer';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { Accordion } from '@kobalte/core/accordion';
import { batch, For, Show } from 'solid-js';
import { useEmailView } from '../email-view-context';
import { useEmailFilters } from '../filters/use-email-filters';
import { EmailInboxDrawerSection } from './EmailInboxSelector';

const INBOX_SECTION_ID = 'inbox';

export function EmailFilterDrawer() {
  const { state, setInboxIds } = useEmailView();
  const filters = useEmailFilters();
  const showFacetFilters = () => state.tab !== 'scheduled';

  return (
    <MobileFilterDrawer
      triggerLabel="Open email filters"
      label="Email filters"
      activeCount={
        (showFacetFilters() ? filters.activeCount() : 0) +
        (state.inboxIds === undefined ? 0 : 1)
      }
      onClear={() =>
        batch(() => {
          filters.clear();
          setInboxIds(undefined);
        })
      }
    >
      <MobileDrawer.Label class="pt-4">
        {showFacetFilters() ? 'Filters' : 'Inboxes'}
      </MobileDrawer.Label>
      <Accordion
        multiple
        collapsible
        defaultValue={[INBOX_SECTION_ID, filters.groups()[0].id]}
      >
        <div class="flex flex-col gap-3">
          <EmailInboxDrawerSection value={INBOX_SECTION_ID} />
          <Show when={showFacetFilters()}>
            <For each={filters.groups()}>
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
          </Show>
        </div>
      </Accordion>
    </MobileFilterDrawer>
  );
}
