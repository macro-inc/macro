import { SearchBar, ViewSidebar } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import { triggerFocusInput } from '@core/directive/focusInput';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import type { ConversationFiltersProps } from '../../components/conversation-filters/conversation-filters';
import { ConversationFiltersDrawer } from './filters/filters';

export function PhoneListHeader(
  props: ConversationFiltersProps & {
    archived: boolean;
    empty: boolean;
    search: string;
    onSearchChange: (value: string) => void;
  }
) {
  const [searchOpen, setSearchOpen] = createSignal(false);
  let input: HTMLInputElement | undefined;
  const closeSearch = () => {
    setSearchOpen(false);
    props.onSearchChange('');
  };
  return (
    <div class="flex min-w-0 items-center justify-between gap-2">
      <ViewSidebar.Toggle action="expand" presentation="pill" />
      <div class="flex min-w-0 flex-1 items-center justify-end gap-2">
        <Show when={!props.empty}>
          <Show
            when={searchOpen() || props.search}
            fallback={
              <>
                <Button
                  aria-label={t('agentWork.searchConversations')}
                  variant="ghost"
                  size="icon-md"
                  finish="island"
                  class="shrink-0"
                  // Keep focus where it is until the search field takes it.
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setSearchOpen(true);
                    triggerFocusInput(() => input);
                  }}
                >
                  <SearchIcon class="size-6 shrink-0" />
                </Button>
                <ConversationFiltersDrawer
                  filters={props.filters}
                  onFilterChange={props.onFilterChange}
                  onClearFilters={props.onClearFilters}
                  showUnlistedRuns={props.showUnlistedRuns}
                  onShowUnlistedRunsChange={props.onShowUnlistedRunsChange}
                />
              </>
            }
          >
            <SearchBar
              ref={input}
              label={
                props.archived
                  ? t('agentWork.searchArchived')
                  : t('agentWork.searchConversations')
              }
              value={props.search}
              onValueChange={props.onSearchChange}
              onClose={closeSearch}
              onEscape={closeSearch}
              class="pointer-events-auto flex-1"
            />
          </Show>
        </Show>
      </div>
    </div>
  );
}
