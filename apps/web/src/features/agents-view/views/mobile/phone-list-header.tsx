import { SearchBar, ViewSidebar } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import { MobileHeader } from '@components/app/mobile-header/mobile-header';
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
    <MobileHeader
      trailing={
        <Show when={!props.empty}>
          <Show
            when={searchOpen() || props.search}
            fallback={
              <>
                <MobileHeader.Island>
                  <Button
                    variant="ghost"
                    size="icon-md"
                    aria-label={t('agentWork.searchConversations')}
                    onClick={() => {
                      setSearchOpen(true);
                      input?.focus();
                    }}
                  >
                    <SearchIcon class="size-5" />
                  </Button>
                </MobileHeader.Island>
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
      }
    >
      <ViewSidebar.Toggle action="expand" presentation="pill" />
    </MobileHeader>
  );
}
