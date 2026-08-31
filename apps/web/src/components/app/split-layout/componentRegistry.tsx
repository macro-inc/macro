import { useActivityFeedFlag } from '@app/features/activity/use-activity-feed-flag';
import type { EventEditorInitialValues } from '@app/features/calendar/components/composer/event-form-model';
import type { CalendarEvent } from '@app/features/calendar/types';
import { GettingStarted } from '@app/features/getting-started';
import { Home } from '@app/features/home';
import { queryStateFrom } from '@app/features/next-soup/filters/filter-store';
import type { SetPredicatesInput } from '@app/features/next-soup/filters/filter-store/predicates-store';
import { mergeQuery } from '@app/features/next-soup/filters/filter-store/query-store';
import type { Query } from '@app/features/next-soup/filters/filter-store/types';
import { getViewPreset } from '@app/features/next-soup/sidebar/soup-filter-presets';
import { NonMemberChannelPreview } from '@app/features/next-soup/soup-view/non-member-channel-preview';
import { SoupView } from '@app/features/next-soup/soup-view/soup-view';
import { useRecentViewFlag } from '@app/features/next-soup/use-recent-view-flag';
import { SettingsPanelComponentWrapper } from '@app/features/settings/Settings';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { usePosthog } from '@app/lib/analytics/posthog';
import { globalSplitManager } from '@app/signal/splitLayout';
import { EventComposerSplit } from '@block-calendar/components/EventComposerSplit';
import { ChannelCompose } from '@block-channel/component/Compose';
import { EmailCompose } from '@block-email/component/compose/Compose';
import { ComposeSkill } from '@block-md/component/ComposeSkill';
import { ComposeTask } from '@block-md/component/ComposeTask';
import {
  CRM_VIEW_URL_PARAM,
  type CrmViewConfig,
  decodeCrmViewParam,
} from '@companies/crm/saved-views';
import { useIsAuthenticated } from '@core/auth';
import { LoadingBlock } from '@core/component/LoadingBlock';
import {
  DEV_MODE_ENV,
  ENABLE_CRM,
  ENABLE_REMINDERS,
  LOCAL_ONLY,
} from '@core/constant/featureFlags';
import { useUserContext } from '@core/context/user';
import type { ViewId } from '@core/types/view';
import EmptyStatePreviewIcon from '@design/empty-state-doc.svg';
import { useAutomationEntities } from '@queries/agent-schedule/entities';
import { EmptyStatePanel } from '@ui';
import { type Component, type JSXElement, lazy, onMount, Show } from 'solid-js';
import type { SplitContent } from './layoutManager';
import { useSplitPanelOrThrow } from './layoutUtils';
import { previewEmptyStateForContent } from './previewController';

function usePageViewTracking(pageTitle: string) {
  const analytics = useAnalytics();
  onMount(() => {
    analytics.pageView(pageTitle);
    analytics.track('open_view', { viewId: pageTitle });
  });
}

/**
 * Guard that delays rendering until user is authenticated.
 * Use for components that require user context (userId, email).
 */
const withAuth = <P extends object>(Comp: Component<P>): Component<P> => {
  return (props: P) => {
    const isAuthenticated = useIsAuthenticated();
    return (
      <Show when={isAuthenticated()} fallback={<LoadingBlock />}>
        <Comp {...props} />
      </Show>
    );
  };
};

type ComponentParams = Record<string, unknown>;

type ComponentFactory = (params: ComponentParams) => JSXElement;

type DocumentsComponentParams = {
  initialFilters?: Query;
  initialClientFilters?: SetPredicatesInput<string>;
};

function mergeClientFilters(
  base?: SetPredicatesInput<string>,
  refinement?: SetPredicatesInput<string>
): SetPredicatesInput<string> | undefined {
  if (!base) return refinement;
  if (!refinement) return base;

  return {
    and: [...new Set([...(base.and ?? []), ...(refinement.and ?? [])])],
    or: [...new Set([...(base.or ?? []), ...(refinement.or ?? [])])],
  };
}

export type ComponentMeta = {
  kind?: string;
  splitPanelLayout?: 'legacy' | 'composable';
};

export type UnifiedListMeta = ComponentMeta & {
  kind: 'unified-list';
  viewId: ViewId;
};

export type ComponentMetaMap = {
  'unified-list': UnifiedListMeta;
};

type ComponentRegistration = {
  factory: ComponentFactory;
  initialMeta?: ComponentMeta;
};

const REGISTRY = new Map<string, ComponentRegistration>();

function registerComponent<TMeta extends Record<string, unknown>>(
  name: string,
  factory: ComponentFactory,
  initialMeta?: TMeta
) {
  const metaWithKind = initialMeta ? { kind: name, ...initialMeta } : undefined;
  REGISTRY.set(name, {
    factory,
    initialMeta: metaWithKind as ComponentMeta,
  });
}

type ResolvedComponent = {
  element: () => JSXElement;
  initialMeta?: ComponentMeta;
};

// Similar to SolidRouter's `<Navigate />` but for splits
function RedirectSplit(props: { to: SplitContent }) {
  const panel = useSplitPanelOrThrow();

  onMount(() => {
    panel.handle.replace({ next: props.to });
  });

  return null;
}

export function resolveComponent(
  name: string,
  params?: ComponentParams
): ResolvedComponent {
  const registration = REGISTRY.get(name);
  if (!registration) throw new Error(`Component '${name}' not registered`);
  return {
    element: () => registration.factory(params ?? {}),
    initialMeta: registration.initialMeta,
  };
}

registerComponent('unified-list', () => (
  <RedirectSplit to={{ type: 'component', id: 'inbox' }} />
));

/** BEGIN - APP ROUTES */
registerComponent(
  'home',
  withAuth(() => {
    usePageViewTracking('home');
    return <Home />;
  })
);

registerComponent(
  'getting-started',
  withAuth(() => {
    usePageViewTracking('getting-started');
    return <GettingStarted />;
  })
);

registerComponent(
  'inbox',
  withAuth(() => {
    usePageViewTracking('inbox');
    const preset = getViewPreset('inbox');
    return (
      <SoupView
        viewName="Inbox"
        initialFilters={preset?.filters}
        initialClientFilters={preset?.clientFilters}
        initialGroupBy={preset?.groupBy}
        disableLocalSearch
      />
    );
  })
);

registerComponent('recent', withAuth(RecentViewWrapper));

function TrackedRecentView() {
  usePageViewTracking('recent');
  const preset = getViewPreset('recent');
  return (
    <SoupView
      viewName="Recent"
      initialFilters={preset?.filters}
      initialClientFilters={preset?.clientFilters}
      // Rows carry the server's touched_at, so sorting on it preserves
      // the touched-by-me order and lets optimistic bumps reorder locally.
      initialClientSort={['touched_at']}
      disableLocalSearch
    />
  );
}

function RecentViewWrapper() {
  const recentViewEnabled = useRecentViewFlag();
  const posthog = usePosthog();

  // Registered even when the flag is off so a bookmarked /recent or a
  // restored split recovers to the inbox instead of an empty split, and the
  // touched query is never issued. The redirect replaces the split
  // irreversibly, so it must wait for PostHog to actually answer — on a
  // fresh reload the flag reads false until flags load.
  return (
    <Show
      when={recentViewEnabled()}
      fallback={
        <Show when={posthog.flagsLoaded()}>
          <RedirectSplit to={{ type: 'component', id: 'inbox' }} />
        </Show>
      }
    >
      <TrackedRecentView />
    </Show>
  );
}

const MyActivityView = lazy(() =>
  import('@app/features/activity/my-activity-view').then((module) => ({
    default: module.MyActivityView,
  }))
);

function TrackedMyActivityView() {
  usePageViewTracking('activity');
  return <MyActivityView />;
}

function MyActivityViewWrapper() {
  const activityFeedEnabled = useActivityFeedFlag();
  const posthog = usePosthog();

  // Registered even when the flag is off so a bookmarked /activity or a
  // restored split recovers to the inbox instead of an empty split, and the
  // data-owning feed view is never mounted. The redirect replaces the split
  // irreversibly, so it must wait for PostHog to actually answer — on a
  // fresh reload the flag reads false until flags load.
  return (
    <Show
      when={activityFeedEnabled()}
      fallback={
        <Show when={posthog.flagsLoaded()}>
          <RedirectSplit to={{ type: 'component', id: 'inbox' }} />
        </Show>
      }
    >
      <TrackedMyActivityView />
    </Show>
  );
}

registerComponent('activity', withAuth(MyActivityViewWrapper));

registerComponent(
  'reminders',
  withAuth(() => {
    // Registered even when the flag is closed so a bookmarked /reminders or a
    // restored split recovers to the inbox instead of an empty split.
    if (!ENABLE_REMINDERS()) {
      return <RedirectSplit to={{ type: 'component', id: 'inbox' }} />;
    }
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
  })
);

// The Activity tab briefly shipped as two separate views; restored splits
// may still reference their ids.
registerComponent('firehose', () => (
  <RedirectSplit to={{ type: 'component', id: 'activity' }} />
));
registerComponent('my-activity', () => (
  <RedirectSplit to={{ type: 'component', id: 'activity' }} />
));

registerComponent(
  'agents',
  withAuth(() => {
    usePageViewTracking('agents');
    const user = useUserContext();
    const preset = getViewPreset('agents', undefined, {
      userId: user.userId(),
      isTeamAdmin: false,
    });
    const automationEntities = useAutomationEntities();
    return (
      <SoupView
        viewName="Agents"
        initialFilters={preset?.filters}
        initialClientFilters={preset?.clientFilters}
        initialGroupBy={preset?.groupBy}
        additionalEntities={automationEntities}
      />
    );
  })
);

registerComponent(
  'mail',
  withAuth(() => {
    usePageViewTracking('mail');
    const preset = getViewPreset('mail');
    return (
      <SoupView
        viewName="Email"
        initialFilters={preset?.filters}
        initialClientFilters={preset?.clientFilters}
        initialGroupBy={preset?.groupBy}
      />
    );
  })
);

registerComponent(
  'documents',
  withAuth((params: DocumentsComponentParams = {}) => {
    usePageViewTracking('documents');
    const user = useUserContext();
    const preset = getViewPreset('documents', undefined, {
      userId: user.userId(),
      isTeamAdmin: false,
    });
    const initialFilters =
      preset?.filters && params.initialFilters
        ? mergeQuery(queryStateFrom(preset.filters), params.initialFilters)
        : (params.initialFilters ?? preset?.filters);
    const initialClientFilters = mergeClientFilters(
      preset?.clientFilters,
      params.initialClientFilters
    );
    return (
      <SoupView
        viewName="Files"
        initialFilters={initialFilters}
        initialClientFilters={initialClientFilters}
        initialGroupBy={preset?.groupBy}
      />
    );
  })
);

registerComponent(
  'tasks',
  withAuth(() => {
    usePageViewTracking('tasks');
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
  })
);

registerComponent(
  'channels',
  withAuth(() => {
    usePageViewTracking('channels');
    const preset = getViewPreset('channels');
    return (
      <SoupView
        viewName="Channels"
        initialFilters={preset?.filters}
        initialClientFilters={preset?.clientFilters}
        initialGroupBy={preset?.groupBy}
      />
    );
  })
);

registerComponent(
  'calls',
  withAuth(() => {
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
  })
);

registerComponent(
  'companies',
  withAuth(() => {
    // Registered even when the CRM feature is off so direct navigation /
    // restored splits redirect instead of throwing in resolveComponent.
    if (!ENABLE_CRM()) {
      return <RedirectSplit to={{ type: 'component', id: 'inbox' }} />;
    }
    usePageViewTracking('companies');
    const preset = getViewPreset('companies');
    // Share links land here as `/companies?crmView=<encoded config>` — the
    // param carries the full view state (never data), decoded client-side.
    const crmViewParam = new URLSearchParams(window.location.search).get(
      CRM_VIEW_URL_PARAM
    );
    const initialCrmView: CrmViewConfig | undefined = crmViewParam
      ? decodeCrmViewParam(crmViewParam)
      : undefined;
    return (
      <SoupView
        viewName="Customers"
        initialFilters={preset?.filters}
        initialClientFilters={preset?.clientFilters}
        initialGroupBy={preset?.groupBy}
        initialCrmView={initialCrmView}
      />
    );
  })
);

registerComponent(
  'folders',
  withAuth(() => {
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
  })
);

type SearchComponentParams = {
  initialQuery?: string;
  initialFilters?: Query;
  initialClientFilters?: SetPredicatesInput<string>;
};

registerComponent(
  'search',
  withAuth((params: SearchComponentParams = {}) => {
    usePageViewTracking('search');
    const preset = getViewPreset('search');
    return (
      <SoupView
        viewName="Search"
        initialFilters={params.initialFilters ?? preset?.filters}
        initialClientFilters={
          params.initialClientFilters ?? preset?.clientFilters
        }
        initialSearchText={params.initialQuery}
      />
    );
  })
);

/** END - APP ROUTES */

registerComponent('loading', () => <LoadingBlock />);
// Placeholder a Preview Pair's Viewer opens before its Controller has
// navigated anywhere (see layoutManager engagePreviewMode). Controllers can
// override the copy via `emptyState` in previewController.ts; resolving it
// from the live pair (rather than params) keeps the override across URL
// restore.
registerComponent('preview-empty', () => {
  const panel = useSplitPanelOrThrow();
  onMount(() => panel.handle.setDisplayName('Preview'));
  const emptyState = () => {
    const manager = globalSplitManager();
    const controllerId = manager?.controllerOf(panel.handle.id);
    const controllerContent = controllerId
      ? manager?.getSplit(controllerId)?.content()
      : undefined;
    return controllerContent
      ? previewEmptyStateForContent(controllerContent)
      : undefined;
  };
  return (
    <EmptyStatePanel
      graphic={EmptyStatePreviewIcon}
      title={emptyState()?.title ?? 'No content selected'}
      description={
        emptyState()?.description ??
        'Select an item from the connected list to preview it here'
      }
      centered
    />
  );
});
// Join prompt for a channel the viewer can see but hasn't joined, shown in a
// Preview Pair's Viewer when the controlling list focuses such a row (see
// openEntityInSplitFromUnifiedList). Params don't round-trip through the URL,
// so a restored split has none — fall back to the placeholder and let the
// controller's focus→preview effect re-open the real prompt.
registerComponent('non-member-channel', (params) => {
  const panel = useSplitPanelOrThrow();
  const channelId =
    typeof params?.channelId === 'string' ? params.channelId : undefined;
  if (!channelId) {
    return <RedirectSplit to={{ type: 'component', id: 'preview-empty' }} />;
  }
  const channelName =
    typeof params?.channelName === 'string' ? params.channelName : 'Channel';
  const memberCount =
    typeof params?.memberCount === 'number' ? params.memberCount : 0;
  onMount(() => panel.handle.setDisplayName(channelName));
  return (
    <NonMemberChannelPreview
      channelId={channelId}
      channelName={channelName}
      memberCount={memberCount}
      // Join landed — hand the Viewer off to the real channel block in place.
      onJoined={() =>
        panel.handle.replace({ next: { type: 'channel', id: channelId } })
      }
    />
  );
});
registerComponent('channel-compose', () => {
  usePageViewTracking('channel-compose');
  return <ChannelCompose />;
});
registerComponent('email-compose', (params) => {
  usePageViewTracking('email-compose');
  // mailto: links land here as `component/email-compose?to=a@x.com,b@y.com`.
  const toParam = new URLSearchParams(window.location.search).get('to');
  const paramsInitialTo = Array.isArray(params.initialTo)
    ? params.initialTo.filter(
        (value): value is string => typeof value === 'string'
      )
    : undefined;
  const initialTo =
    paramsInitialTo ??
    toParam
      ?.split(',')
      .map((e) => e.trim())
      .filter(Boolean);
  const draftID =
    typeof params.draftID === 'string' ? params.draftID : undefined;
  return <EmailCompose draftID={draftID} initialTo={initialTo} />;
});
registerComponent('task-compose', (params) => {
  usePageViewTracking('task-compose');
  return <ComposeTask {...params} />;
});
registerComponent('calendar-event-compose', (params) => {
  usePageViewTracking('calendar-event-compose');
  return (
    <EventComposerSplit
      event={params?.event as CalendarEvent | undefined}
      initialValues={
        params?.initialValues as EventEditorInitialValues | undefined
      }
      onCalendarChange={
        params?.onCalendarChange as
          | ((calendarId: string, color: string) => void)
          | undefined
      }
      onDirtyChange={
        params?.onDirtyChange as ((dirty: boolean) => void) | undefined
      }
      onSaveSuccess={params?.onSaveSuccess as (() => void) | undefined}
    />
  );
});
registerComponent('skill-compose', (params) => {
  usePageViewTracking('skill-compose');
  return <ComposeSkill {...params} />;
});
registerComponent(
  'import-linear',
  lazy(() => import('@app/features/integrations/import-linear/ImportLinear'))
);
registerComponent('settings', () => <SettingsPanelComponentWrapper />);

if (LOCAL_ONLY) {
  registerComponent(
    'theme-edit-3',
    lazy(() => import('@theme/components/ThemeEdit3'))
  );
  registerComponent(
    'theme-debug',
    lazy(() => import('@core/internal/ThemeDebug'))
  );
  registerComponent(
    'core',
    lazy(() => import('@core/internal/App'))
  );
  registerComponent(
    'md',
    lazy(
      () =>
        import('@core/component/LexicalMarkdown/component/debug/EditorTestPage')
    )
  );
  registerComponent(
    'data',
    lazy(() => import('@core/internal/DataDebug'))
  );
  registerComponent(
    'noise',
    lazy(() => import('@core/internal/PcNoiseGridDemo'))
  );
  registerComponent(
    'svg-noise',
    lazy(() => import('@core/internal/SvgNoiseGridDemo'))
  );
  registerComponent(
    'chat',
    lazy(() => import('@core/component/AI/component/debug/Component'))
  );

  registerComponent(
    'chat-attachment',
    lazy(() => import('@core/component/AI/component/debug/Attachment'))
  );
  registerComponent(
    'chat-tool',
    lazy(() => import('@core/component/AI/component/debug/Tool'))
  );
  registerComponent(
    'http-stream',
    lazy(() => import('@core/component/AI/component/debug/HttpStream'))
  );
  registerComponent(
    'static-markdown-stream',
    lazy(
      () => import('@core/component/AI/component/debug/StaticMarkdownStream')
    )
  );
  registerComponent(
    'resize',
    lazy(() => import('@core/internal/ResizeDemo'))
  );

  registerComponent(
    'notifications-playground',
    lazy(() =>
      import('@notifications/components/Playground').then((m) => ({
        default: m.NotificationsPlayground,
      }))
    )
  );

  registerComponent(
    'props-debug',
    lazy(() => import('@property/debug/PropertyDebug'))
  );

  registerComponent(
    'entity-debug',
    lazy(() => import('@entity/debug/DebugEntityView'))
  );

  registerComponent(
    'quick-access-list',
    lazy(() => import('@core/context/quickAccess/debug/QuickAccessAll'))
  );

  registerComponent(
    'hotkey-debugger',
    lazy(() => import('@app/features/devtools/HotkeyDebugger'))
  );

  registerComponent(
    'user-icon',
    lazy(() => import('@core/internal/UserIconDemo'))
  );

  registerComponent(
    'dynamic-ui',
    lazy(() => import('@app/features/dynamic-ui/Gallery'))
  );

  registerComponent(
    'agent-ui',
    lazy(() => import('@app/features/block-agent/debug/Gallery'))
  );

  registerComponent(
    'agent-replay',
    lazy(() => import('@app/features/block-agent/debug/replay/Replay'))
  );

  registerComponent(
    'linked-conversation',
    withAuth(lazy(() => import('@core/linked-conversation/debug/Demo')))
  );
}

if (DEV_MODE_ENV) {
  registerComponent(
    'document-where-playground',
    withAuth(
      lazy(
        () => import('@app/features/next-soup/debug/DocumentWherePlayground')
      )
    )
  );

  registerComponent(
    'projection-playground',
    withAuth(
      lazy(() => import('@app/features/devtools/debug/ProjectionPlayground'))
    )
  );

  // NOTE (seamus) : putting pixel icons on dev/staging for aidan
  registerComponent(
    'pixel-icon',
    lazy(() => import('@core/internal/PixelArtIconDemo'))
  );
  registerComponent(
    'md-parse',
    lazy(
      () =>
        import(
          '@core/component/LexicalMarkdown/component/debug/MarkdownParseTestPage'
        )
    )
  );
  registerComponent(
    'md-builder',
    lazy(
      () => import('@core/component/LexicalMarkdown/builder/BuilderTestPage')
    )
  );
  registerComponent(
    'collab-surface-demo',
    withAuth(
      lazy(() => import('@core/collab-surface/debug/CollabSurfaceDemoPage'))
    )
  );
}

// Icon gallery
registerComponent(
  'icon-gallery',
  lazy(() => import('@core/internal/IconGallery'))
);
