import { MobileFilterDrawer } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { batch, For } from 'solid-js';
import {
  type ConversationFiltersProps,
  FILTER_GROUPS,
} from '../../../components/conversation-filters/conversation-filters';
import { activeFilterCount } from '../../../core/conversation-filters';

/** The phone shell uses the same filter values in the standard filter sheet. */
export function ConversationFiltersDrawer(props: ConversationFiltersProps) {
  return (
    <MobileFilterDrawer
      triggerLabel={t('agentWork.filterConversations')}
      label={t('agentWork.filterConversations')}
      activeCount={
        activeFilterCount(props.filters) + (props.showUnlistedRuns ? 1 : 0)
      }
      onClear={() =>
        batch(() => {
          props.onClearFilters();
          props.onShowUnlistedRunsChange(false);
        })
      }
    >
      <div class="flex flex-col gap-4 px-3">
        <For each={FILTER_GROUPS}>
          {(group) => (
            <>
              <div>
                <MobileDrawer.Label>{group.label}</MobileDrawer.Label>
                <MobileDrawer.Section>
                  <For each={group.options}>
                    {(option) => (
                      <MobileFilterDrawer.Option
                        icon={option.icon?.()}
                        checked={props.filters[group.id].some(
                          (value) => value === option.id
                        )}
                        onChange={(selected) =>
                          props.onFilterChange(group.id, option.id, selected)
                        }
                      >
                        {option.label}
                      </MobileFilterDrawer.Option>
                    )}
                  </For>
                </MobileDrawer.Section>
              </div>
            </>
          )}
        </For>
        <MobileDrawer.Section>
          <MobileFilterDrawer.Option
            checked={props.showUnlistedRuns}
            onChange={props.onShowUnlistedRunsChange}
          >
            {t('viewMenus.showHiddenRoutineRuns')}
          </MobileFilterDrawer.Option>
        </MobileDrawer.Section>
      </div>
    </MobileFilterDrawer>
  );
}
