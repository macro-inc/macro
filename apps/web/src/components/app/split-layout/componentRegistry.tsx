import { ActivityRouteView } from '@app/features/activity/route-views';
import { parseAgentsRoute } from '@app/features/agents-view/core/route';
import { AgentsRouteView } from '@app/features/agents-view/route-views';
import { useSpreadsheetAccess } from '@app/features/block-spreadsheet/primitives/use-spreadsheet-access';
import type { EventEditorInitialValues } from '@app/features/calendar/components/composer/event-form-model';
import type { CalendarEvent } from '@app/features/calendar/types';
import { CalendarRouteView } from '@app/features/calendar-view/route-views';
import { ChannelsRouteView } from '@app/features/channels-view/route-views';
import { CompaniesRouteView } from '@app/features/crm/route-views';
import { DriveRouteView } from '@app/features/drive-view/route-views';
import { EmailCompose } from '@app/features/email-compose/email-compose';
import { MailRouteView } from '@app/features/email-view/route-views';
import { GettingStartedRouteView } from '@app/features/getting-started/route-views';
import { HomeRouteView } from '@app/features/home/route-views';
import {
  CallsRouteView,
  FoldersRouteView,
  RecentRouteView,
  SearchRouteView,
} from '@app/features/next-soup/route-views';
import { parseProjectRoute } from '@app/features/projects/core/route';
import {
  CreateProjectView,
  ProjectsListView,
  ProjectView,
} from '@app/features/projects/project-view';
import { REMINDER_DETAIL_COMPONENT_ID } from '@app/features/reminders/reminder-navigation';
import { RemindersRouteView } from '@app/features/reminders/route-views';
import { ReviewsRouteView } from '@app/features/reviews-view/route-views';
import { RoutineCreator } from '@app/features/routines/routine-creator';
import { SettingsRouteView } from '@app/features/settings/route-views';
import { TasksRouteView } from '@app/features/tasks-view/route-views';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { NOT_FOUND_ROUTE_ID } from '@app/routes/app-route';
import { EventComposerSplit } from '@block-calendar/components/EventComposerSplit';
import { ChannelCompose } from '@block-channel/component/Compose';
import { ComposeSkill } from '@block-md/component/ComposeSkill';
import { ComposeTask } from '@block-md/component/ComposeTask';
import { ComposeDocument } from '@block-md/views/compose-document';
import NotFound from '@core/component/AccessErrorViews/NotFound';
import { LoadingBlock } from '@core/component/LoadingBlock';
import {
  DEV_MODE_ENV,
  enableChatV3Agents,
  enableProjects,
  isFeatureEnabled,
  LOCAL_ONLY,
} from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { ViewId } from '@core/types/view';
import {
  type JSXElement,
  lazy,
  onMount,
  type ParentProps,
  Show,
} from 'solid-js';
import { useSplitPanelOrThrow } from './layoutUtils';
import {
  RedirectSplit,
  usePageViewTracking,
  withAuth,
} from './split-router/app-route-shell';

type ComponentParams = Record<string, unknown>;

type ComponentFactory = (params: ComponentParams) => JSXElement;

export type ComponentMeta = {
  kind?: string;
  splitPanelLayout?: 'legacy' | 'composable';
  ownsCollectionState?: boolean;
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
  initialMeta?: ComponentMeta | (() => ComponentMeta | undefined);
};

const REGISTRY = new Map<string, ComponentRegistration>();

/** Shell for views that draw their own top bar. */
function composableLayout(onTouch = false): ComponentMeta | undefined {
  if (isTouchDevice() && !onTouch) return;
  return { splitPanelLayout: 'composable' };
}

function registerComponent(
  name: string,
  factory: ComponentFactory,
  initialMeta?: ComponentMeta | (() => ComponentMeta | undefined)
) {
  REGISTRY.set(name, { factory, initialMeta });
}

function resolveInitialMeta(
  name: string,
  initialMeta: ComponentRegistration['initialMeta']
): ComponentMeta | undefined {
  const meta = typeof initialMeta === 'function' ? initialMeta() : initialMeta;
  return meta ? { kind: name, ...meta } : undefined;
}

type ResolvedComponent = {
  element: () => JSXElement;
  initialMeta?: ComponentMeta;
};

export function resolveComponent(
  name: string,
  params?: ComponentParams
): ResolvedComponent {
  const registration = REGISTRY.get(name);
  if (!registration) {
    if (parseProjectRoute(name)) {
      const base = REGISTRY.get('initiative-view');
      if (base)
        return {
          element: () =>
            base.factory({ ...(params ?? {}), projectRoute: name }),
          initialMeta: resolveInitialMeta('initiative-view', base.initialMeta),
        };
    }
    if (parseAgentsRoute(name)) {
      const base = REGISTRY.get('agents');
      if (base) {
        return {
          element: () => base.factory({ ...(params ?? {}), agentsRoute: name }),
          initialMeta: resolveInitialMeta('agents', base.initialMeta),
        };
      }
    }
    throw new Error(`Component '${name}' not registered`);
  }
  return {
    element: () => registration.factory(params ?? {}),
    initialMeta: resolveInitialMeta(name, registration.initialMeta),
  };
}

registerComponent('unified-list', () => (
  <RedirectSplit to={{ type: 'component', id: 'home' }} />
));

function DisabledProjectsRoute() {
  const panel = useSplitPanelOrThrow();
  onMount(() => {
    if (panel.handle.isPopover()) panel.handle.close();
    else panel.handle.replace({ next: { type: 'component', id: 'tasks' } });
  });
  return null;
}

function ProjectsRouteGate(props: ParentProps) {
  const flag = useFeatureFlag(enableProjects);
  return (
    <Show
      when={flag().enabled}
      fallback={
        <Show when={!flag().loading} fallback={<LoadingBlock />}>
          <DisabledProjectsRoute />
        </Show>
      }
    >
      {props.children}
    </Show>
  );
}

const GatedCreateProjectView: typeof CreateProjectView = (props) => (
  <ProjectsRouteGate>
    <CreateProjectView {...props} />
  </ProjectsRouteGate>
);

registerComponent('new-project', withAuth(GatedCreateProjectView), {
  splitPanelLayout: 'composable',
});
registerComponent('project-compose', withAuth(GatedCreateProjectView), {
  splitPanelLayout: 'composable',
});
registerComponent(
  'initiative-view',
  withAuth((params) => {
    const route =
      typeof params.projectRoute === 'string'
        ? parseProjectRoute(params.projectRoute)
        : undefined;
    return route ? (
      <ProjectsRouteGate>
        <ProjectView route={route} />
      </ProjectsRouteGate>
    ) : (
      <RedirectSplit to={{ type: 'component', id: 'tasks' }} />
    );
  }),
  { splitPanelLayout: 'composable' }
);
registerComponent(
  'tasks-projects',
  withAuth(() => (
    <ProjectsRouteGate>
      <ProjectsListView />
    </ProjectsRouteGate>
  )),
  { splitPanelLayout: 'composable' }
);

// Compatibility factories for restored content and hosts outside a route outlet.
// App views themselves are composed by the application route layer.
registerComponent(
  'home',
  () => <HomeRouteView />,
  () => composableLayout(true)
);
registerComponent('getting-started', () => <GettingStartedRouteView />);
registerComponent(NOT_FOUND_ROUTE_ID, () => <NotFound />);
registerComponent('recent', () => <RecentRouteView />);
registerComponent('activity', () => <ActivityRouteView />);
registerComponent('reminders', () => <RemindersRouteView />);
registerComponent(
  'routines',
  () => <AgentsRouteView />,
  () => composableLayout()
);
registerComponent(
  'agents',
  () => <AgentsRouteView />,
  () =>
    isFeatureEnabled(enableChatV3Agents)
      ? { splitPanelLayout: 'composable' }
      : undefined
);
registerComponent(
  'mail',
  () => <MailRouteView />,
  () => composableLayout()
);
registerComponent(
  'documents',
  () => <DriveRouteView />,
  () => composableLayout(true)
);
registerComponent('reviews', () => <ReviewsRouteView />);
registerComponent(
  'tasks',
  () => <TasksRouteView />,
  () => composableLayout(true)
);
registerComponent(
  'calendar',
  () => <CalendarRouteView />,
  // Desktop Calendar draws its own top bar. Touch still needs the split header
  // for the floating month and action controls.
  () => (isTouchDevice() ? undefined : { splitPanelLayout: 'composable' })
);
registerComponent(
  'channels',
  () => <ChannelsRouteView />,
  () => composableLayout()
);
registerComponent('calls', () => <CallsRouteView />);
registerComponent(
  'companies',
  () => <CompaniesRouteView />,
  () => ({
    ownsCollectionState: true,
    ...(isTouchDevice() ? {} : { splitPanelLayout: 'composable' as const }),
  })
);
registerComponent('folders', () => <FoldersRouteView />);
registerComponent('search', () => <SearchRouteView />);
registerComponent('firehose', () => (
  <RedirectSplit to={{ type: 'component', id: 'activity' }} />
));
registerComponent('my-activity', () => (
  <RedirectSplit to={{ type: 'component', id: 'activity' }} />
));

registerComponent('loading', () => <LoadingBlock />);
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
  const initialInboxId =
    typeof params.initialInboxId === 'string'
      ? params.initialInboxId
      : undefined;
  return (
    <EmailCompose
      draftId={draftID}
      initialTo={initialTo}
      initialInboxId={initialInboxId}
    />
  );
});
registerComponent('routine-compose', (params) => (
  <RoutineCreator
    onCreated={
      typeof params.onCreated === 'function'
        ? (params.onCreated as (id: string) => void)
        : undefined
    }
  />
));
registerComponent('document-compose', (params) => {
  usePageViewTracking('document-compose');
  return <ComposeDocument {...params} />;
});

registerComponent('task-compose', (params) => {
  usePageViewTracking('task-compose');
  return <ComposeTask {...params} />;
});
// Restore old composer URLs into the shared Agents page.
registerComponent('agent-session-compose', () => (
  <RedirectSplit to={{ type: 'component', id: 'agents' }} />
));
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
registerComponent(REMINDER_DETAIL_COMPONENT_ID, () => <RemindersRouteView />);

registerComponent(
  'import-linear',
  lazy(() => import('@app/features/integrations/import-linear/ImportLinear'))
);
registerComponent(
  'settings',
  () => <SettingsRouteView />,
  () => composableLayout()
);

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
    'agent-changes-ui',
    lazy(() => import('@app/features/changes/debug/Gallery'))
  );

  registerComponent(
    'diff-view-ui',
    lazy(() => import('@app/components/diff-view/debug/DiffViewGallery'))
  );
}

if (import.meta.env.DEV) {
  registerComponent(
    'spreadsheet-demo',
    withAuth(() => {
      const enabled = useSpreadsheetAccess();
      const Demo = lazy(
        () => import('@app/features/block-spreadsheet/SpreadsheetDemo')
      );
      return (
        <Show
          when={enabled()}
          fallback={<RedirectSplit to={{ type: 'component', id: 'home' }} />}
        >
          <Demo />
        </Show>
      );
    })
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

// Component library. Registered outside LOCAL_ONLY so design can browse it on
// preview deploys; the whole gallery is one lazy chunk the app never loads
// unless the route is opened.
registerComponent(
  'ui',
  lazy(() => import('@app/features/ui-gallery/UiGallery'))
);
