import '@fontsource-variable/inter';
import '../../../../index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { UserContextProvider } from '@core/context/user';
import { authKeys } from '@queries/auth/keys';
import { queryClient } from '@queries/client';
import { teamKeys } from '@queries/team/keys';
import type { Team } from '@service-auth/generated/schemas/team';
import { QueryClientProvider } from '@tanstack/solid-query';
import { render } from 'solid-js/web';
import { macroLightTheme } from '../../../theme/themes/macro-light';
import { themeCssVars } from '../../../theme/utils/themeCssVars';
import { TeamMembers } from '../../TeamMembers';

for (const [key, token] of Object.entries(themeCssVars(macroLightTheme)))
  document.documentElement.style.setProperty(key, token);
document.documentElement.dataset.themeLight = 'true';

const team: Team = {
  id: 'team-1',
  name: 'Northwind',
  slug: 'northwind',
  owner_id: 'macro|maya@example.com',
  allow_non_admin_invites: true,
  crm_enabled: false,
  enterprise: false,
};

// The viewer, an owner. The roster, invites and agents come from the spec's
// scripted auth service, so a refetch after an invite reads its new state.
queryClient.setQueryData(authKeys.userInfo.queryKey, {
  id: team.owner_id,
  email: 'maya@example.com',
  authenticated: true,
});
queryClient.setQueryData(teamKeys.invites(team.id).queryKey, { invites: [] });

const root = document.getElementById('root');
if (root)
  render(
    () => (
      <QueryClientProvider client={queryClient}>
        <AnalyticsContextProvider>
          <PosthogProvider>
            <UserContextProvider>
              <EmailLinksContextProvider>
                <div class="mx-auto max-w-3xl">
                  <TeamMembers team={team} />
                </div>
              </EmailLinksContextProvider>
            </UserContextProvider>
          </PosthogProvider>
        </AnalyticsContextProvider>
      </QueryClientProvider>
    ),
    root
  );
