import '@fontsource-variable/inter';
import '../../../../index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { setGlobalSplitManager } from '@app/signal/splitLayout';
import type {
  SplitContent,
  SplitManager,
} from '@components/app/split-layout/layoutManager';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { UserContextProvider } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { authKeys } from '@queries/auth/keys';
import { queryClient } from '@queries/client';
import { teamKeys } from '@queries/team/keys';
import type { Team } from '@service-auth/generated/schemas/team';
import type { ComputerSetupMetadata } from '@service-notification/generated/schemas';
import { QueryClientProvider } from '@tanstack/solid-query';
import { ImperativeDialogHost } from '@ui';
import { Layer } from '@ui/components/Layer';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { macroLightTheme } from '../../../theme/themes/macro-light';
import { themeCssVars } from '../../../theme/utils/themeCssVars';
import { TeamMembers } from '../../TeamMembers';
import {
  TeamAgentStatusBanner,
  TeamAgentStatusChip,
} from '../../views/team-agent-dm-status';

for (const [key, token] of Object.entries(themeCssVars(macroLightTheme)))
  document.documentElement.style.setProperty(key, token);
document.documentElement.dataset.themeLight = 'true';
// The fixture uses the same touch variant switch as the app entry point.
document.documentElement.dataset.touchDevice = String(isTouchDevice());

const team: Team = {
  id: 'team-1',
  name: 'Northwind',
  slug: 'northwind',
  owner_id: 'macro|maya@example.com',
  allow_non_admin_invites: true,
  crm_enabled: false,
  enterprise: false,
};

// The viewer comes from the page's URL (`?viewer=macro|sam@example.com`), an
// owner by default. The roster, invites and agents come from the spec's
// scripted auth service, so a refetch after an invite reads its new state.
const viewer =
  new URLSearchParams(window.location.search).get('viewer') ?? team.owner_id;
queryClient.setQueryData(authKeys.userInfo.queryKey, {
  id: viewer,
  email: viewer.replace('macro|', ''),
  authenticated: true,
});
queryClient.setQueryData(teamKeys.invites(team.id).queryKey, { invites: [] });

declare global {
  interface Window {
    teamAgentsFixture: {
      /** Where the app navigated: a DM, or Settings → Members. */
      opened: SplitContent[];
      /** A computer setup notification arriving from the realtime feed. */
      notify: (content: ComputerSetupMetadata) => Promise<void>;
      /** Shows the DM with `userId`: its header chip and composer banner. */
      openDm: (userId: string) => void;
    };
  }
}

const [dmWith, setDmWith] = createSignal<string>();

// Navigation is recorded, not performed: this page is Members alone.
window.teamAgentsFixture = {
  opened: [],
  notify: async (content) => {
    const { handleNotificationUpdate } = await import(
      '../../../notifications/use-notification-updates'
    );
    handleNotificationUpdate({
      id: `setup-${content.computerId}-${content.outcome.kind}`,
      entity_id: 'team-1',
      entity_type: 'team',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      state: 'unseen',
      sent: true,
      notification_event_type: 'computer_setup',
      notification_metadata: { tag: 'computer_setup', content },
    });
  },
  openDm: setDmWith,
};
setGlobalSplitManager({
  openWithSplit(content: SplitContent) {
    window.teamAgentsFixture.opened.push(content);
    return { status: 'unavailable' };
  },
} as SplitManager);

/** The parts of a DM that say whether its agent teammate is running. */
function DirectMessage(props: { userId: string }) {
  return (
    <section
      aria-label="Direct message"
      class="mx-auto mt-6 flex max-w-3xl flex-col rounded-xl border border-edge-muted bg-page"
    >
      <header class="flex h-12 items-center gap-2 border-b border-edge-muted px-4">
        <span class="min-w-0 flex-1 truncate text-sm font-medium text-ink">
          Ada
        </span>
        <TeamAgentStatusChip userId={props.userId} />
      </header>
      <div class="h-40" />
      <div class="px-4 pb-4">
        <TeamAgentStatusBanner userId={props.userId} />
        <div class="macro-message-width mx-auto rounded-2xl border border-edge-muted px-3 py-2.5 text-sm text-ink-muted">
          Message Ada
        </div>
      </div>
    </section>
  );
}

const root = document.getElementById('root');
if (root)
  render(
    () => (
      <QueryClientProvider client={queryClient}>
        <AnalyticsContextProvider>
          <PosthogProvider>
            <UserContextProvider>
              <EmailLinksContextProvider>
                <Layer>
                  <Show
                    when={dmWith()}
                    fallback={
                      <div class="mx-auto max-w-3xl">
                        <TeamMembers team={team} />
                      </div>
                    }
                  >
                    {(userId) => <DirectMessage userId={userId()} />}
                  </Show>
                  <ImperativeDialogHost />
                  <ToastRegion />
                </Layer>
              </EmailLinksContextProvider>
            </UserContextProvider>
          </PosthogProvider>
        </AnalyticsContextProvider>
      </QueryClientProvider>
    ),
    root
  );
