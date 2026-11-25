import { SearchBar, ViewSidebar } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';

export function AgentsSidebarHeader(props: {
  search: string;
  searchOpen: boolean;
  onSearchChange: (value: string) => void;
  onSearchOpenChange: (open: boolean) => void;
  inputRef: (input: HTMLInputElement) => void;
}) {
  return (
    <ViewSidebar.Header
      searchLabel={t('agentWork.searchConversations')}
      searchOpen={props.searchOpen}
      onSearchOpenChange={props.onSearchOpenChange}
      search={() => (
        <SearchBar
          ref={props.inputRef}
          placeholder={t('agentWork.searchConversations')}
          label={t('agentWork.searchConversations')}
          value={props.search}
          onValueChange={props.onSearchChange}
          onEscape={() => {
            if (!props.search) props.onSearchOpenChange(false);
          }}
        />
      )}
    >
      <div class="flex min-w-0 items-center gap-1">
        <ViewSidebar.CloseButton />
        <ViewSidebar.Title>{t('agentWork.agents')}</ViewSidebar.Title>
      </div>
    </ViewSidebar.Header>
  );
}
