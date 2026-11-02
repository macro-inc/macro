import EmptyStateCompaniesGraphic from '@design/empty-state-companies.svg';
import { EmptyStatePanel } from '@ui';
import { Match, Switch } from 'solid-js';
import {
  CrmListEmpty,
  CrmListError,
  CrmListSearchEmpty,
  CrmListSkeleton,
} from '../components/list-state';
import { useCrmContext } from '../context/crm-context';
import { useCrmWorkspace } from '../context/workspace-context';
import { useCurrentTeamQuery, useIsTeamAdmin } from './use-crm';

export function CrmEmptyState(
  props: {
    filtered?: boolean;
    onClearFilters?: () => void;
    onClearPeopleSearch?: () => void;
    onEditList?: () => void;
  } = {}
) {
  const {
    host,
    activeTab,
    queryFilters,
    searchText,
    setSearchText,
    stageFilter,
    ownerFilter,
  } = useCrmWorkspace();
  const { openCreateCompany, openCreateContact } = useCrmContext();
  const peopleSearch = () => queryFilters.state.include.crmContactSearch;
  const teamQuery = useCurrentTeamQuery();
  const isTeamAdmin = useIsTeamAdmin();
  const teamResolved = () => teamQuery.data !== undefined;
  const crmEnabled = () => teamQuery.data?.team.crm_enabled ?? false;
  const hasNoTeam = () => teamQuery.data === null;
  return (
    <Switch>
      <Match when={teamQuery.isError && !teamResolved()}>
        <CrmListError
          title="Couldn't load CRM settings."
          onRetry={() => teamQuery.refetch()}
        />
      </Match>
      <Match when={!teamResolved()}>
        <CrmListSkeleton label="Loading CRM" />
      </Match>
      <Match when={hasNoTeam()}>
        <EmptyStatePanel
          centered
          topSpacerClass="grow-[0.5] basis-0 mobile:basis-0"
          graphic={EmptyStateCompaniesGraphic}
          title="Join a team to enable CRM"
          description="Create or join a team in Settings > Team."
          primaryAction={{
            label: 'Open team settings',
            onClick: () => host.openTeamSettings(),
          }}
        />
      </Match>
      <Match when={!crmEnabled()}>
        <EmptyStatePanel
          centered
          topSpacerClass="grow-[0.5] basis-0 mobile:basis-0"
          graphic={EmptyStateCompaniesGraphic}
          title="CRM is disabled"
          description={
            isTeamAdmin()
              ? 'Enable CRM in Settings > CRM to start tracking your customers.'
              : 'Team owners and admins can enable CRM in Settings > CRM.'
          }
          primaryAction={
            isTeamAdmin()
              ? {
                  label: 'Open CRM settings',
                  onClick: () => host.settings.open(),
                }
              : undefined
          }
        />
      </Match>
      <Match when={activeTab() === 'people' && !!peopleSearch()}>
        <CrmListSearchEmpty
          title="No matching people"
          description="Try a different name or email address."
          onClearSearch={props.onClearPeopleSearch}
        />
      </Match>
      <Match when={activeTab() === 'people' && props.filtered}>
        <CrmListEmpty
          filtered
          title="No people match these filters"
          description="Try adjusting or clearing your filters."
          action={
            props.onClearFilters
              ? { label: 'Clear filters', onClick: props.onClearFilters }
              : undefined
          }
        />
      </Match>
      <Match when={activeTab() === 'people'}>
        <CrmListEmpty
          title="No people yet"
          description="People connected to your CRM companies will appear here."
          action={{ label: 'Add person', onClick: () => openCreateContact() }}
        />
      </Match>
      <Match when={!!searchText().trim()}>
        <CrmListSearchEmpty
          title="No matching companies"
          onClearSearch={() => setSearchText('')}
        />
      </Match>
      <Match
        when={
          (props.filtered && !activeTab()?.startsWith('list:')) ||
          stageFilter().length > 0 ||
          ownerFilter().length > 0
        }
      >
        <CrmListEmpty
          filtered
          title="No companies match these filters"
          description="Try adjusting the stage or owner filters."
          action={
            props.onClearFilters
              ? { label: 'Clear filters', onClick: props.onClearFilters }
              : undefined
          }
        />
      </Match>
      <Match when={true}>
        <CrmListEmpty
          title={
            !activeTab() || activeTab() === 'active'
              ? 'No customers yet'
              : activeTab()?.startsWith('list:')
                ? 'No companies in this list'
                : 'No companies in this view'
          }
          description={
            !activeTab() || activeTab() === 'active'
              ? 'Customers your team emails will appear here.'
              : activeTab()?.startsWith('list:')
                ? 'Use Edit list to add companies to this collection.'
                : 'Companies that match this view will appear here.'
          }
          action={
            !activeTab() || activeTab() === 'active'
              ? { label: 'Add company', onClick: openCreateCompany }
              : props.onEditList
                ? { label: 'Edit list', onClick: props.onEditList }
                : undefined
          }
        />
      </Match>
    </Switch>
  );
}
