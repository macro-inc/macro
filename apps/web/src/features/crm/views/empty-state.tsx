import EmptyStateCompaniesGraphic from '@design/empty-state-companies.svg';
import { EmptyStatePanel } from '@ui';
import { Match, Switch } from 'solid-js';
import { useCrmWorkspace } from '../context/workspace-context';
import { useCurrentTeamQuery, useIsTeamAdmin } from './use-crm';

export function CrmEmptyState() {
  const { host, activeTab, queryFilters } = useCrmWorkspace();
  const peopleSearch = () => queryFilters.state.include.crmContactSearch;
  const teamQuery = useCurrentTeamQuery();
  const isTeamAdmin = useIsTeamAdmin();
  const teamResolved = () => teamQuery.data !== undefined;
  const crmEnabled = () => teamQuery.data?.team.crm_enabled ?? false;
  const hasNoTeam = () => teamQuery.data === null;
  return (
    <Switch>
      {/* Render nothing until the team query resolves — showing a wrong
              panel for a moment is worse than a brief blank. */}
      <Match when={!teamResolved()}>{null}</Match>
      <Match when={hasNoTeam()}>
        <EmptyStatePanel
          centered
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
                  onClick: () => host.openSettings(),
                }
              : undefined
          }
        />
      </Match>
      <Match when={activeTab() === 'people'}>
        <EmptyStatePanel
          graphic={EmptyStateCompaniesGraphic}
          title={peopleSearch() ? 'No matching people' : 'No people yet'}
          description={
            peopleSearch()
              ? 'Try a name or email address.'
              : 'People connected to your CRM companies will appear here.'
          }
        />
      </Match>
      <Match when={true}>
        <EmptyStatePanel
          graphic={EmptyStateCompaniesGraphic}
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
        />
      </Match>
    </Switch>
  );
}
