import '@fontsource-variable/inter';
import '../../../../index.css';
import { analytics } from '@app/lib/analytics/analytics';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { setGlobalSplitManager } from '@app/signal/splitLayout';
import { CallProvider } from '@channel/Call/CallContext';
import { Channel } from '@channel/Channel/Channel';
import { ChannelTabProvider } from '@channel/Channel/ChannelTabContext';
import { GlobalAppStateProvider } from '@components/app/GlobalAppState';
import type {
  SplitContent,
  SplitManager,
} from '@components/app/split-layout/layoutManager';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { ChannelDirectoryProvider } from '@core/context/channels';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { QuickAccessProvider } from '@core/context/quickAccess/QuickAccessProvider';
import { UserContextProvider } from '@core/context/user';
import { useHotKeyRoot } from '@core/hotkey/hotkeys';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { BlockOrchestrator } from '@core/orchestrator';
import { EntityProvider } from '@entity';
import type { NotificationSource } from '@notifications';
import { authKeys } from '@queries/auth/keys';
import { staticChannelDirectory } from '@queries/channel/directory';
import { queryClient } from '@queries/client';
import { teamKeys } from '@queries/team/keys';
import type { Team } from '@service-auth/generated/schemas/team';
import type { ComputerSetupMetadata } from '@service-notification/generated/schemas';
import { QueryClientProvider } from '@tanstack/solid-query';
import { DragDropProvider } from '@thisbeyond/solid-dnd';
import { ImperativeDialogHost } from '@ui';
import { Layer } from '@ui/components/Layer';
import { createSignal, Show, Suspense } from 'solid-js';
import { render } from 'solid-js/web';
import { macroDarkTheme } from '../../../theme/themes/macro-dark';
import { macroLightTheme } from '../../../theme/themes/macro-light';
import { themeCssVars } from '../../../theme/utils/themeCssVars';
import { SettingsPage } from '../../primitives';
import { TeamMembers } from '../../TeamMembers';
import { CrmMemberAccessSection } from '../../views/crm-member-access';
import {
  TeamAgentStatusBanner,
  TeamAgentStatusChip,
} from '../../views/team-agent-dm-status';

// `?dark` renders the page in the dark theme.
const params = new URLSearchParams(window.location.search);
const dark = params.has('dark');
for (const [key, token] of Object.entries(
  themeCssVars(dark ? macroDarkTheme : macroLightTheme)
))
  document.documentElement.style.setProperty(key, token);
document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
document.documentElement.dataset.themeLight = String(!dark);
// The fixture uses the same touch variant switch as the app entry point.
document.documentElement.dataset.touchDevice = String(isTouchDevice());

// Boot the SDK with a local-only flag answer; the production reader still decides visibility.
analytics.posthog.init('local-browser-fixture', {
  api_host: location.origin,
  persistence: 'memory',
  advanced_disable_flags: true,
  capture_pageview: false,
  autocapture: false,
  disable_session_recording: true,
  bootstrap: {
    featureFlags: {
      'enable-crm-member-access-changes':
        new URLSearchParams(location.search).get('crmAccessChanges') !== 'off',
      'fixture-flags-loaded': true,
    },
  },
});

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
const viewer = params.get('viewer') ?? team.owner_id;
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
      /** Switches between Members and CRM settings' Who can use CRM, keeping the cache. */
      showPage: (page: 'members' | 'crm') => void;
    };
  }
}

const [dmWith, setDmWith] = createSignal<string>();
// `?crm` opens on CRM settings' Who can use CRM, which shares Members' team reads.
const [shownPage, setShownPage] = createSignal<'members' | 'crm'>(
  new URLSearchParams(window.location.search).has('crm') ? 'crm' : 'members'
);

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
  showPage: setShownPage,
};
setGlobalSplitManager({
  activeSplitId: () => undefined,
  activeSplit: () => undefined,
  openWithSplit(content: SplitContent) {
    window.teamAgentsFixture.opened.push(content);
    if (content.type === 'component' && content.id === 'settings')
      setDmWith(undefined);
    return { status: 'unavailable' };
  },
} as SplitManager);

/** A minimal DM shell for the agent header and composer status checks. */
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

const noNotifications = {
  notificationsByEntity: () => ({}),
  bulkMarkAsRead: async () => undefined,
} as unknown as NotificationSource;
const noBlocks = {} as BlockOrchestrator;

/** The real channel timeline with a scripted directory and message service. */
function GreetingConversation(props: { userId: string }) {
  useHotKeyRoot();
  const channelId = `dm-${props.userId}`;
  const date = '2026-11-11T09:00:00Z';
  const directory = staticChannelDirectory(() => [
    {
      id: channelId,
      name: 'Ada',
      channelType: 'direct_message',
      ownerId: props.userId,
      organizationId: null,
      teamId: null,
      autoJoinTeam: false,
      createdAt: date,
      updatedAt: date,
      viewedAt: null,
      interactedAt: null,
      isParticipant: true,
      frecencyScore: null,
      participants: [
        { userId: props.userId, role: 'owner', joinedAt: date, leftAt: null },
        { userId: viewer, role: 'member', joinedAt: date, leftAt: null },
      ],
      botParticipants: [],
      agentDm: null,
      latestMessage: null,
      latestNonThreadMessage: null,
    },
  ]);

  return (
    <EntityProvider>
      <ChannelDirectoryProvider directory={directory}>
        <CallProvider>
          <QuickAccessProvider>
            <GlobalAppStateProvider
              notificationSource={noNotifications}
              blockOrchestrator={noBlocks}
            >
              <DragDropProvider>
                <ChannelTabProvider
                  activeTab={() => 'messages'}
                  setActiveTab={() => {}}
                >
                  <section
                    aria-label="Direct message"
                    class="flex h-screen min-h-0 flex-col"
                  >
                    <Suspense>
                      <Channel channelId={channelId} autofocus={false} />
                    </Suspense>
                  </section>
                </ChannelTabProvider>
              </DragDropProvider>
            </GlobalAppStateProvider>
          </QuickAccessProvider>
        </CallProvider>
      </ChannelDirectoryProvider>
    </EntityProvider>
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
                        <Show
                          when={shownPage() === 'crm'}
                          fallback={<TeamMembers team={team} />}
                        >
                          <SettingsPage title="CRM">
                            <CrmMemberAccessSection />
                          </SettingsPage>
                        </Show>
                      </div>
                    }
                  >
                    {(userId) =>
                      params.has('greeting') ? (
                        <GreetingConversation userId={userId()} />
                      ) : (
                        <DirectMessage userId={userId()} />
                      )
                    }
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
