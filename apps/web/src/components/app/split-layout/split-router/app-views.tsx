import { openEntityInSplit } from '@app/features/activity/open-entity-in-split';
import { useActivityFeedFlag } from '@app/features/activity/use-activity-feed-flag';
import { parseAgentsRoute } from '@app/features/agents-view/core/route';
import { AgentsView } from '@app/features/agents-view/views/AgentsView';
import { ChannelsView } from '@app/features/channels-view/channels-view';
import {
  DriveView,
  type DriveViewProps,
} from '@app/features/drive-view/drive-view';
import { EmailView } from '@app/features/email-view/email-view';
import { GettingStarted } from '@app/features/getting-started';
import { Home } from '@app/features/home';
import { InboxView } from '@app/features/inbox-view/inbox-view';
import { queryStateFrom } from '@app/features/next-soup/filters/filter-store';
import type { SetPredicatesInput } from '@app/features/next-soup/filters/filter-store/predicates-store';
import { mergeQuery } from '@app/features/next-soup/filters/filter-store/query-store';
import type { Query } from '@app/features/next-soup/filters/filter-store/types';
import { getViewPreset } from '@app/features/next-soup/sidebar/soup-filter-presets';
import { useRecentViewFlag } from '@app/features/next-soup/use-recent-view-flag';
import { McpConnections } from '@app/features/settings/McpConnections';
import { SettingsPanelComponentWrapper } from '@app/features/settings/Settings';
import { TasksView } from '@app/features/tasks-view/tasks-view';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useFeatureFlag, usePosthog } from '@app/lib/analytics/posthog';
import {
  CRM_VIEW_URL_PARAM,
  decodeCrmViewParam,
} from '@companies/crm/saved-views';
import { useIsAuthenticated } from '@core/auth';
import { LoadingBlock } from '@core/component/LoadingBlock';
import {
  enableChatV3Agents,
  enableCrm,
  enableNewAppViews,
  enableReminders,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { useUserContext } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useAutomationEntities } from '@queries/agent-schedule/entities';
import {
  type Component,
  createRenderEffect,
  createSignal,
  type JSX,
  lazy,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import type { SplitContent } from '../layoutManager';
import { useSplitPanelOrThrow } from '../layoutUtils';

// Legacy fallbacks are loaded only when a view actually needs them.
const SoupView = lazy(async () => ({
  default: (await import('@app/features/next-soup/soup-view/soup-view'))
    .SoupView,
}));

export function usePageViewTracking(pageTitle: string) {
  const analytics = useAnalytics();
  onMount(() => {
    analytics.pageView(pageTitle);
    analytics.track('open_view', { viewId: pageTitle });
  });
}

export function withAuth<P extends object>(View: Component<P>): Component<P> {
  return (props) => {
    const authenticated = useIsAuthenticated();
    return (
      <Show when={authenticated()} fallback={<LoadingBlock />}>
        <View {...props} />
      </Show>
    );
  };
}

// Settings URL helpers also read app routes. Resolve the component only when
// rendering, so route declarations never capture a partially initialized module.
export function withLaunchParams(
  view: () => Component<Record<string, unknown>>
) {
  return () => {
    const View = view();
    const content = useSplitPanelOrThrow().handle.content();
    return <View {...(content.type === 'component' ? content.params : {})} />;
  };
}

export function RedirectSplit(props: { to: SplitContent }) {
  const panel = useSplitPanelOrThrow();
  onMount(() => panel.handle.replace({ next: props.to }));
  return null;
}

/** App-only feature gating and shell metadata; feature views stay route-agnostic. */
function NewAppView(props: {
  id: string;
  children: JSX.Element;
  fallback: JSX.Element;
  desktopOnly?: boolean;
  composableOnTouch?: boolean;
}) {
  usePageViewTracking(props.id);
  const panel = useSplitPanelOrThrow();
  const flag = useFeatureFlag(enableNewAppViews);
  const [timedOut, setTimedOut] = createSignal(false);
  const timer = setTimeout(() => setTimedOut(true), 5_000);
  onCleanup(() => clearTimeout(timer));
  const ready = () => !flag().loading || timedOut();
  const enabled = () => ready() && flag().enabled;
  createRenderEffect(() => {
    if (!ready()) return;
    panel.handle.updateMeta?.({
      splitPanelLayout:
        enabled() && (!isTouchDevice() || props.composableOnTouch)
          ? 'composable'
          : 'legacy',
    });
  });
  return (
    <Show
      when={ready() || (props.desktopOnly && isTouchDevice())}
      fallback={<LoadingBlock />}
    >
      <Show
        when={enabled() && (!props.desktopOnly || !isTouchDevice())}
        fallback={props.fallback}
      >
        {props.children}
      </Show>
    </Show>
  );
}

export const HomeView = withAuth(() => {
  usePageViewTracking('home');
  return <Home />;
});
export const GettingStartedView = withAuth(() => {
  usePageViewTracking('getting-started');
  return <GettingStarted />;
});

function LegacyInboxView() {
  const preset = getViewPreset('inbox');
  return (
    <SoupView
      viewName={isTouchDevice() ? 'Notifications' : 'Home'}
      initialFilters={preset?.filters}
      initialClientFilters={preset?.clientFilters}
      initialGroupBy={preset?.groupBy}
      disableLocalSearch
    />
  );
}
export const InboxRouteView = withAuth(() => (
  <NewAppView id="inbox" composableOnTouch fallback={<LegacyInboxView />}>
    <InboxView />
  </NewAppView>
));

function TrackedRecentView() {
  usePageViewTracking('recent');
  const preset = getViewPreset('recent');
  return (
    <SoupView
      viewName="Recent"
      initialFilters={preset?.filters}
      initialClientFilters={preset?.clientFilters}
      initialClientSort={['touched_at']}
      disableLocalSearch
    />
  );
}
export const RecentView = withAuth(() => {
  const enabled = useRecentViewFlag();
  const posthog = usePosthog();
  return (
    <Show
      when={enabled()}
      fallback={
        <Show when={posthog.flagsLoaded()}>
          <RedirectSplit to={{ type: 'component', id: 'inbox' }} />
        </Show>
      }
    >
      <TrackedRecentView />
    </Show>
  );
});

const MyActivityView = lazy(async () => ({
  default: (await import('@app/features/activity/views/my-activity-view'))
    .MyActivityView,
}));
function TrackedActivityView() {
  usePageViewTracking('activity');
  return <MyActivityView onOpen={openEntityInSplit} />;
}
export const ActivityView = withAuth(() => {
  const enabled = useActivityFeedFlag();
  const posthog = usePosthog();
  return (
    <Show
      when={enabled()}
      fallback={
        <Show when={posthog.flagsLoaded()}>
          <RedirectSplit to={{ type: 'component', id: 'inbox' }} />
        </Show>
      }
    >
      <TrackedActivityView />
    </Show>
  );
});

export const RemindersView = withAuth(() => {
  if (!isFeatureEnabled(enableReminders))
    return <RedirectSplit to={{ type: 'component', id: 'inbox' }} />;
  usePageViewTracking('reminders');
  const preset = getViewPreset('reminders');
  return (
    <SoupView
      viewName="Reminders"
      initialFilters={preset?.filters}
      initialClientFilters={preset?.clientFilters}
      initialGroupBy={preset?.groupBy}
      disableLocalSearch
    />
  );
});

function LegacyAgentsView() {
  const user = useUserContext();
  const preset = getViewPreset('agents', undefined, {
    userId: user.userId(),
    isTeamAdmin: false,
  });
  const entities = useAutomationEntities();
  return (
    <SoupView
      viewName="Agents"
      initialFilters={preset?.filters}
      initialClientFilters={preset?.clientFilters}
      initialGroupBy={preset?.groupBy}
      additionalEntities={entities}
    />
  );
}
export const AgentsRouteView = withAuth((params: Record<string, unknown>) => {
  const panel = useSplitPanelOrThrow();
  const route = parseAgentsRoute(
    typeof params.agentsRoute === 'string'
      ? params.agentsRoute
      : panel.handle.content().id
  );
  usePageViewTracking('agents');
  const flag = useFeatureFlag(enableChatV3Agents);
  const enabled = () => flag().enabled && !isTouchDevice();
  const connectionsRequested = () => {
    const content = panel.handle.content();
    return (
      content.type === 'component' &&
      content.params?.agentPage === 'connections'
    );
  };
  createRenderEffect(() => {
    if (!flag().loading)
      panel.handle.updateMeta?.({
        splitPanelLayout: enabled() ? 'composable' : 'legacy',
      });
  });
  return (
    <Show when={!flag().loading} fallback={<LoadingBlock />}>
      <Show
        when={enabled()}
        fallback={
          <Show
            when={connectionsRequested()}
            fallback={
              route ? (
                <RedirectSplit
                  to={{
                    type:
                      route.conversation.type === 'agent_session'
                        ? 'agent'
                        : 'chat',
                    id: route.conversation.id,
                  }}
                />
              ) : (
                <LegacyAgentsView />
              )
            }
          >
            <McpConnections />
          </Show>
        }
      >
        <AgentsView initialRoute={route} />
      </Show>
    </Show>
  );
});

function LegacyMailView() {
  const preset = getViewPreset('mail');
  return (
    <SoupView
      viewName="Email"
      initialFilters={preset?.filters}
      initialClientFilters={preset?.clientFilters}
      initialGroupBy={preset?.groupBy}
    />
  );
}
export const MailView = withAuth(() => (
  <NewAppView id="mail" fallback={<LegacyMailView />}>
    <EmailView />
  </NewAppView>
));

export const DriveRouteView = withAuth(
  (
    props: DriveViewProps & {
      initialFilters?: Query;
      initialClientFilters?: SetPredicatesInput<string>;
    }
  ) => {
    const user = useUserContext();
    const preset = getViewPreset('documents', undefined, {
      userId: user.userId(),
      isTeamAdmin: false,
    });
    const initialFilters =
      preset?.filters && props.initialFilters
        ? mergeQuery(queryStateFrom(preset.filters), props.initialFilters)
        : (props.initialFilters ?? preset?.filters);
    const initialClientFilters =
      preset?.clientFilters && props.initialClientFilters
        ? {
            and: [
              ...new Set([
                ...(preset.clientFilters.and ?? []),
                ...(props.initialClientFilters.and ?? []),
              ]),
            ],
            or: [
              ...new Set([
                ...(preset.clientFilters.or ?? []),
                ...(props.initialClientFilters.or ?? []),
              ]),
            ],
          }
        : (props.initialClientFilters ?? preset?.clientFilters);
    return (
      <NewAppView
        id="documents"
        composableOnTouch
        fallback={
          <SoupView
            viewName="Files"
            initialFilters={initialFilters}
            initialClientFilters={initialClientFilters}
            initialGroupBy={preset?.groupBy}
          />
        }
      >
        <DriveView initialFacets={props.initialFacets} />
      </NewAppView>
    );
  }
);

function LegacyTasksView() {
  const user = useUserContext();
  const preset = getViewPreset('tasks', undefined, {
    userId: user.userId(),
    isTeamAdmin: false,
  });
  return (
    <SoupView
      viewName="Tasks"
      initialFilters={preset?.filters}
      initialClientFilters={preset?.clientFilters}
      initialGroupBy={preset?.groupBy}
    />
  );
}
export const TasksRouteView = withAuth(() => (
  <NewAppView id="tasks" composableOnTouch fallback={<LegacyTasksView />}>
    <TasksView />
  </NewAppView>
));

function LegacyChannelsView() {
  const preset = getViewPreset('channels');
  return (
    <SoupView
      viewName="Channels"
      initialFilters={preset?.filters}
      initialClientFilters={preset?.clientFilters}
      initialGroupBy={preset?.groupBy}
    />
  );
}
export const ChannelsRouteView = withAuth(() => (
  <NewAppView id="channels" fallback={<LegacyChannelsView />}>
    <ChannelsView />
  </NewAppView>
));

export const CallsView = withAuth(() => {
  usePageViewTracking('calls');
  const preset = getViewPreset('calls');
  return (
    <SoupView
      viewName="Calls"
      initialFilters={preset?.filters}
      initialClientFilters={preset?.clientFilters}
      initialGroupBy={preset?.groupBy}
    />
  );
});
export const CompaniesView = withAuth(() => {
  if (!isFeatureEnabled(enableCrm))
    return <RedirectSplit to={{ type: 'component', id: 'inbox' }} />;
  usePageViewTracking('companies');
  const panel = useSplitPanelOrThrow();
  createRenderEffect(() =>
    panel.handle.updateMeta?.({
      splitPanelLayout: isTouchDevice() ? 'legacy' : 'composable',
    })
  );
  const preset = getViewPreset('companies');
  const crmView = new URLSearchParams(window.location.search).get(
    CRM_VIEW_URL_PARAM
  );
  return (
    <SoupView
      viewName="Customers"
      initialFilters={preset?.filters}
      initialClientFilters={preset?.clientFilters}
      initialGroupBy={preset?.groupBy}
      initialCrmView={crmView ? decodeCrmViewParam(crmView) : undefined}
    />
  );
});
export const FoldersView = withAuth(() => {
  usePageViewTracking('folders');
  const user = useUserContext();
  const preset = getViewPreset('folders', undefined, {
    userId: user.userId(),
    isTeamAdmin: false,
  });
  return (
    <SoupView
      viewName="Folders"
      initialFilters={preset?.filters}
      initialClientFilters={preset?.clientFilters}
      initialGroupBy={preset?.groupBy}
    />
  );
});
export const SearchView = withAuth(
  (props: {
    initialQuery?: string;
    initialFilters?: Query;
    initialClientFilters?: SetPredicatesInput<string>;
  }) => {
    usePageViewTracking('search');
    const preset = getViewPreset('search');
    return (
      <SoupView
        viewName="Search"
        initialFilters={props.initialFilters ?? preset?.filters}
        initialClientFilters={
          props.initialClientFilters ?? preset?.clientFilters
        }
        initialSearchText={props.initialQuery}
      />
    );
  }
);
export const SettingsView = SettingsPanelComponentWrapper;
