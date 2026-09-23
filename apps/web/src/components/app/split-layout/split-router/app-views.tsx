import { openEntityInSplit } from '@app/features/activity/open-entity-in-split';
import { useActivityFeedFlag } from '@app/features/activity/use-activity-feed-flag';
import { parseAgentsRoute } from '@app/features/agents-view/core/route';
import { AgentsView } from '@app/features/agents-view/views/AgentsView';
import { channelDetailSearch } from '@app/features/channels-view/channels-route';
import {
  ChannelDetailRouteView,
  ChannelsView,
} from '@app/features/channels-view/channels-view';
import { DriveDetailView } from '@app/features/drive-view/components/DriveDetailView';
import {
  DriveView,
  type DriveViewProps,
} from '@app/features/drive-view/drive-view';
import { URL_PARAMS as EMAIL_URL_PARAMS } from '@app/features/email-thread/core/location';
import { EmailDetailRouteView } from '@app/features/email-view/components/EmailDetailView';
import { emailDetailSearch } from '@app/features/email-view/email-route';
import { EmailView } from '@app/features/email-view/email-view';
import { GettingStarted } from '@app/features/getting-started';
import { Home } from '@app/features/home';
import {
  inboxPreviewLegacyTarget,
  inboxPreviewSearch,
} from '@app/features/inbox-view/inbox-route';
import {
  InboxDetailRouteView,
  InboxView,
} from '@app/features/inbox-view/inbox-view';
import { queryStateFrom } from '@app/features/next-soup/filters/filter-store';
import type { SetPredicatesInput } from '@app/features/next-soup/filters/filter-store/predicates-store';
import { mergeQuery } from '@app/features/next-soup/filters/filter-store/query-store';
import type { Query } from '@app/features/next-soup/filters/filter-store/types';
import { getViewPreset } from '@app/features/next-soup/sidebar/soup-filter-presets';
import { useRecentViewFlag } from '@app/features/next-soup/use-recent-view-flag';
import { McpConnections } from '@app/features/settings/McpConnections';
import { SettingsPanelComponentWrapper } from '@app/features/settings/Settings';
import { TasksDetailRouteView } from '@app/features/tasks-view/components/TasksDetailView';
import { TasksView } from '@app/features/tasks-view/tasks-view';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useFeatureFlag, usePosthog } from '@app/lib/analytics/posthog';
import { createSearchParams, useRouteParams } from '@app/lib/split-router';
import { URL_PARAMS as CHANNEL_URL_PARAMS } from '@block-channel/constants';
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
import {
  channelDetailRoute,
  emailThreadRoute,
  inboxPreviewRoute,
  taskDetailRoute,
} from './app-routes';

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
  detailRequested?: () => boolean;
  detailFallback?: JSX.Element;
  detailDesktopOnly?: boolean;
}) {
  usePageViewTracking(props.id);
  const panel = useSplitPanelOrThrow();
  const flag = useFeatureFlag(enableNewAppViews);
  const [timedOut, setTimedOut] = createSignal(false);
  const timer = setTimeout(() => setTimedOut(true), 5_000);
  onCleanup(() => clearTimeout(timer));
  const ready = () => !flag().loading || timedOut();
  const enabled = () => ready() && flag().enabled;
  const detailUnsupported = () =>
    Boolean(
      props.detailRequested?.() && props.detailDesktopOnly && isTouchDevice()
    );
  const surfaceSupported = () => !props.desktopOnly || !isTouchDevice();
  const renderModern = () =>
    enabled() && surfaceSupported() && !detailUnsupported();
  const fallback = () => {
    if (!props.detailRequested?.()) return props.fallback;
    // JSX props are getters: evaluate the chosen fallback only once.
    const detail = props.detailFallback;
    return detail === undefined ? props.fallback : detail;
  };
  createRenderEffect(() => {
    if (!ready()) return;
    panel.handle.updateMeta?.({
      splitPanelLayout:
        renderModern() && (!isTouchDevice() || props.composableOnTouch)
          ? 'composable'
          : 'legacy',
    });
  });
  return (
    <Show
      when={
        ready() || (props.desktopOnly && isTouchDevice()) || detailUnsupported()
      }
      fallback={<LoadingBlock />}
    >
      <Show when={renderModern()} fallback={fallback()}>
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
function InboxLegacyRouteView() {
  const params = useRouteParams(inboxPreviewRoute);
  const [search] = createSearchParams(inboxPreviewSearch);
  const detailRequested = () =>
    typeof params.blockType === 'string' &&
    typeof params.previewId === 'string';

  return (
    <Show when={detailRequested()} fallback={<LegacyInboxView />}>
      <RedirectSplit
        to={inboxPreviewLegacyTarget(params, search) as SplitContent}
      />
    </Show>
  );
}

export const InboxRouteView = withAuth(() => {
  const params = useRouteParams(inboxPreviewRoute);
  const detailRequested = () =>
    typeof params.blockType === 'string' &&
    typeof params.previewId === 'string';

  return (
    <NewAppView
      id="inbox"
      composableOnTouch
      detailDesktopOnly
      detailRequested={detailRequested}
      detailFallback={<InboxLegacyRouteView />}
      fallback={<LegacyInboxView />}
    >
      <InboxView />
    </NewAppView>
  );
});

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
function MailLegacyRouteView() {
  const params = useRouteParams(emailThreadRoute);
  const [search] = createSearchParams(emailDetailSearch);
  const legacyThread = (id: string): SplitContent => {
    const params: Record<string, string> = {};
    if (search.messageId) params[EMAIL_URL_PARAMS.messageId] = search.messageId;
    return { type: 'email', id, params };
  };

  return (
    <Show when={params.threadId} fallback={<LegacyMailView />}>
      {(threadId) => <RedirectSplit to={legacyThread(threadId())} />}
    </Show>
  );
}

export const MailView = withAuth(() => {
  const params = useRouteParams(emailThreadRoute);
  const detailRequested = () => typeof params.threadId === 'string';

  return (
    <NewAppView
      id="mail"
      detailDesktopOnly
      detailRequested={detailRequested}
      detailFallback={<MailLegacyRouteView />}
      fallback={<LegacyMailView />}
    >
      <EmailView />
    </NewAppView>
  );
});

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
function TasksLegacyRouteView() {
  const params = useRouteParams(taskDetailRoute);
  return (
    <Show when={params.taskId} fallback={<LegacyTasksView />}>
      {(taskId) => <RedirectSplit to={{ type: 'task', id: taskId() }} />}
    </Show>
  );
}

export const TasksRouteView = withAuth(() => {
  const params = useRouteParams(taskDetailRoute);
  const detailRequested = () => typeof params.taskId === 'string';

  return (
    <NewAppView
      id="tasks"
      composableOnTouch
      detailDesktopOnly
      detailRequested={detailRequested}
      detailFallback={<TasksLegacyRouteView />}
      fallback={<LegacyTasksView />}
    >
      <TasksView />
    </NewAppView>
  );
});

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
function ChannelsLegacyRouteView() {
  const params = useRouteParams(channelDetailRoute);
  const [search] = createSearchParams(channelDetailSearch);
  const legacyChannel = (id: string): SplitContent => {
    const params: Record<string, string> = {};
    if (search.messageId) params[CHANNEL_URL_PARAMS.message] = search.messageId;
    if (search.threadId) params[CHANNEL_URL_PARAMS.thread] = search.threadId;
    return { type: 'channel', id, params };
  };

  return (
    <Show when={params.channelId} fallback={<LegacyChannelsView />}>
      {(channelId) => <RedirectSplit to={legacyChannel(channelId())} />}
    </Show>
  );
}

export const ChannelsRouteView = withAuth(() => {
  const params = useRouteParams(channelDetailRoute);
  const detailRequested = () => typeof params.channelId === 'string';

  return (
    <NewAppView
      id="channels"
      detailDesktopOnly
      detailRequested={detailRequested}
      detailFallback={<ChannelsLegacyRouteView />}
      fallback={<LegacyChannelsView />}
    >
      <ChannelsView />
    </NewAppView>
  );
});

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

const appRouteViews = {
  home: HomeView,
  'getting-started': GettingStartedView,
  inbox: InboxRouteView,
  'inbox-detail': InboxDetailRouteView,
  recent: RecentView,
  activity: ActivityView,
  reminders: RemindersView,
  agents: AgentsRouteView,
  mail: MailView,
  'mail-detail': EmailDetailRouteView,
  drive: DriveRouteView,
  'drive-detail': DriveDetailView,
  tasks: TasksRouteView,
  'tasks-detail': TasksDetailRouteView,
  channels: ChannelsRouteView,
  'channels-detail': ChannelDetailRouteView,
  calls: CallsView,
  companies: CompaniesView,
  folders: FoldersView,
  search: SearchView,
  settings: SettingsView,
} as const;

export type AppRouteViewId = keyof typeof appRouteViews;

/** Shared lazy boundary target for every application route component. */
export function AppRouteRenderer(props: { view: AppRouteViewId }) {
  const View = appRouteViews[props.view] as Component<Record<string, unknown>>;
  const content = useSplitPanelOrThrow().handle.content();
  return <View {...(content.type === 'component' ? content.params : {})} />;
}
