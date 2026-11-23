import { parseAgentsRoute } from '@app/features/agents-view/core/route';
import type { EventEditorInitialValues } from '@app/features/calendar/components/composer/event-form-model';
import {
  DayDraftRangeContext,
  isDayDraftRangeBinding,
} from '@app/features/calendar/context/day-draft-range-context';
import type { CreatedCalendarEvent } from '@app/features/calendar/core/composer';
import type { CalendarEvent } from '@app/features/calendar/types';
import {
  composePropsFromParams,
  recipientsFromLink,
} from '@app/features/email-compose/compose-params';
import { HomeRouteView } from '@app/features/home/route-views';
import { parseProjectRoute } from '@app/features/projects/core/route';
import { NOT_FOUND_ROUTE_ID } from '@app/routes/app-route';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { DEV_MODE_ENV, LOCAL_ONLY } from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { ViewId } from '@core/types/view';
import { lazy } from '@core/util/lazy';
import { lazyNamed } from '@core/util/lazyNamed';
import type { JSXElement } from 'solid-js';
import {
  RedirectSplit,
  usePageViewTracking,
  withAuth,
} from './split-router/app-route-shell';

// Views load as their own chunks the first time a split opens them.
const ForYouRouteView = lazyNamed(
  () => import('@app/features/suggestions/route-views'),
  'ForYouRouteView'
);
const PasswordsRouteView = lazyNamed(
  () => import('@app/features/passwords/route-views'),
  'PasswordsRouteView'
);
const ActivityRouteView = lazyNamed(
  () => import('@app/features/activity/route-views'),
  'ActivityRouteView'
);
const NewHomeRouteView = lazyNamed(
  () => import('@app/features/new-home/route-views'),
  'NewHomeRouteView'
);
const NotificationsRouteView = lazyNamed(
  () => import('@app/features/notifications-inbox/route-views'),
  'NotificationsRouteView'
);
const AgentsRouteView = lazyNamed(
  () => import('@app/features/agents-view/route-views'),
  'AgentsRouteView'
);
const CalendarRouteView = lazyNamed(
  () => import('@app/features/calendar-view/route-views'),
  'CalendarRouteView'
);
const CalendarSearchRouteView = lazyNamed(
  () => import('@app/features/calendar-view/calendar-search-route'),
  'CalendarSearchRouteView'
);
const CalendarSettingsRouteView = lazyNamed(
  () => import('@app/features/calendar-view/calendar-settings-route'),
  'CalendarSettingsRouteView'
);
const BookingLinksRouteView = lazyNamed(
  () => import('@app/features/scheduling/route-views'),
  'BookingLinksRouteView'
);
const ChannelsRouteView = lazyNamed(
  () => import('@app/features/channels-view/route-views'),
  'ChannelsRouteView'
);
const CompaniesRouteView = lazyNamed(
  () => import('@app/features/crm/route-views'),
  'CompaniesRouteView'
);
const DriveRouteView = lazyNamed(
  () => import('@app/features/drive-view/route-views'),
  'DriveRouteView'
);
const EmailCompose = lazyNamed(
  () => import('@app/features/email-compose/email-compose'),
  'EmailCompose'
);
const MailRouteView = lazyNamed(
  () => import('@app/features/email-view/route-views'),
  'MailRouteView'
);
const CallsRouteView = lazyNamed(
  () => import('@app/features/next-soup/route-views'),
  'CallsRouteView'
);
const FoldersRouteView = lazyNamed(
  () => import('@app/features/next-soup/route-views'),
  'FoldersRouteView'
);
const RecentRouteView = lazyNamed(
  () => import('@app/features/next-soup/route-views'),
  'RecentRouteView'
);
const SearchRouteView = lazyNamed(
  () => import('@app/features/next-soup/route-views'),
  'SearchRouteView'
);
const FolderComposeView = lazyNamed(
  () => import('@app/features/drive-view/folder-compose-view'),
  'FolderComposeView'
);
const CreateProjectView = lazyNamed(
  () => import('@app/features/projects/project-view'),
  'CreateProjectView'
);
const ProjectsListView = lazyNamed(
  () => import('@app/features/projects/project-view'),
  'ProjectsListView'
);
const ProjectView = lazyNamed(
  () => import('@app/features/projects/project-view'),
  'ProjectView'
);
const ExternalRouteView = lazyNamed(
  () => import('@app/features/external-view/route-views'),
  'ExternalRouteView'
);
const ReviewsRouteView = lazyNamed(
  () => import('@app/features/reviews-view/route-views'),
  'ReviewsRouteView'
);
const RoutineCreator = lazyNamed(
  () => import('@app/features/routines/routine-creator'),
  'RoutineCreator'
);
const SettingsRouteView = lazyNamed(
  () => import('@app/features/settings/route-views'),
  'SettingsRouteView'
);
const TasksRouteView = lazyNamed(
  () => import('@app/features/tasks-view/route-views'),
  'TasksRouteView'
);
const CalendarComposerSplitAdapter = lazyNamed(
  () => import('@block-calendar/components/CalendarComposerSplitAdapter'),
  'CalendarComposerSplitAdapter'
);
const ChannelCompose = lazyNamed(
  () => import('@block-channel/component/Compose'),
  'ChannelCompose'
);
const ComposeSkill = lazyNamed(
  () => import('@block-md/component/ComposeSkill'),
  'ComposeSkill'
);
const ComposeTask = lazyNamed(
  () => import('@app/features/task-composer/compose-task'),
  'ComposeTask'
);
const ComposeDocument = lazyNamed(
  () => import('@block-md/views/compose-document'),
  'ComposeDocument'
);
const NotFound = lazy(
  () => import('@core/component/AccessErrorViews/NotFound')
);

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

// Retired Getting Started checklist: restored layouts and old
// `/component/getting-started` links land on Home.
registerComponent('getting-started', () => (
  <RedirectSplit to={{ type: 'component', id: 'home' }} />
));

registerComponent('new-project', withAuth(CreateProjectView), {
  splitPanelLayout: 'composable',
});
registerComponent('folder-compose', withAuth(FolderComposeView), {
  splitPanelLayout: 'composable',
});
registerComponent('project-compose', withAuth(CreateProjectView), {
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
      <ProjectView route={route} />
    ) : (
      <RedirectSplit to={{ type: 'component', id: 'tasks' }} />
    );
  }),
  { splitPanelLayout: 'composable' }
);
registerComponent(
  'tasks-projects',
  withAuth(() => <ProjectsListView />),
  { splitPanelLayout: 'composable' }
);

// Compatibility factories for restored content and hosts outside a route outlet.
// App views themselves are composed by the application route layer.
registerComponent(
  'home',
  () => <HomeRouteView />,
  () => composableLayout(true)
);
// New Home's rail item and `g h`: it sends the split on to Recent or
// Notifications, so it takes the shell they draw on desktop.
registerComponent(
  'new-home',
  () => <NewHomeRouteView />,
  () => composableLayout()
);
registerComponent(NOT_FOUND_ROUTE_ID, () => <NotFound />);
registerComponent('recent', () => <RecentRouteView />);
registerComponent(
  'for-you',
  () => <ForYouRouteView />,
  () => composableLayout()
);
registerComponent('activity', () => <ActivityRouteView />);
registerComponent(
  'passwords',
  () => <PasswordsRouteView />,
  () => composableLayout()
);
registerComponent(
  'notifications',
  () => <NotificationsRouteView />,
  () => composableLayout()
);
registerComponent('routines', () => <AgentsRouteView />, {
  splitPanelLayout: 'composable',
});
registerComponent('agents-archive', () => <AgentsRouteView />, {
  splitPanelLayout: 'composable',
});
registerComponent('agents', () => <AgentsRouteView />, {
  splitPanelLayout: 'composable',
});
registerComponent(
  'mail',
  () => <MailRouteView />,
  () => composableLayout(true)
);
registerComponent(
  'documents',
  () => <DriveRouteView />,
  () => composableLayout(true)
);
registerComponent(
  'reviews',
  () => <ReviewsRouteView />,
  () => composableLayout(true)
);
registerComponent(
  'tasks',
  () => <TasksRouteView />,
  () => composableLayout(true)
);
registerComponent(
  'calendar',
  () => <CalendarRouteView />,
  () => composableLayout(true)
);
registerComponent(
  'calendar-search',
  () => <CalendarSearchRouteView />,
  () => composableLayout(true)
);
registerComponent(
  'calendar-settings',
  () => <CalendarSettingsRouteView />,
  () => composableLayout(true)
);
registerComponent(
  'channels',
  () => <ChannelsRouteView />,
  () => composableLayout(true)
);
registerComponent(
  'calls',
  () => <CallsRouteView />,
  () => composableLayout(true)
);
registerComponent('companies', () => <CompaniesRouteView />, {
  ownsCollectionState: true,
  splitPanelLayout: 'composable',
});
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
  // mailto: links land here as
  // `component/email-compose?to=a@example.com,b@example.com` on touch;
  // desktop carries `to` into its `/mail/new` route.
  const toParam = new URLSearchParams(window.location.search).get('to');
  const props = composePropsFromParams(params);
  return (
    <EmailCompose
      {...props}
      initialTo={props.initialTo ?? recipientsFromLink(toParam)}
    />
  );
});
registerComponent('routine-compose', (params) => (
  <RoutineCreator
    onStart={
      typeof params.onStart === 'function'
        ? (params.onStart as () => void)
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
  const composer = () => (
    <CalendarComposerSplitAdapter
      event={params?.event as CalendarEvent | undefined}
      initialValues={
        params?.initialValues as EventEditorInitialValues | undefined
      }
      suggestedValues={
        params?.suggestedValues as
          | Promise<Partial<EventEditorInitialValues>>
          | undefined
      }
      initialDrawerHeight={
        typeof params?.initialDrawerHeight === 'number'
          ? params.initialDrawerHeight
          : undefined
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
      onCreated={
        params?.onCreated as
          | ((created: CreatedCalendarEvent) => void)
          | undefined
      }
    />
  );
  const dayDraftRange = isDayDraftRangeBinding(params?.dayDraftRange)
    ? params.dayDraftRange
    : undefined;
  return dayDraftRange ? (
    <DayDraftRangeContext.Provider value={dayDraftRange}>
      {composer()}
    </DayDraftRangeContext.Provider>
  ) : (
    composer()
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
registerComponent(
  'settings',
  () => <SettingsRouteView />,
  () => composableLayout(true)
);
registerComponent(
  'booking-links',
  () => <BookingLinksRouteView />,
  () => composableLayout()
);
registerComponent(
  'external',
  () => <ExternalRouteView />,
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
    'chat-tool',
    lazy(() => import('@core/component/AI/component/debug/Tool'))
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
    'agent-cards',
    lazy(() => import('@app/features/agent-cards/debug/Gallery'))
  );

  registerComponent(
    'agent-progress',
    lazy(() => import('@app/features/agent-activity/debug/ProgressPlayground'))
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
    withAuth(
      lazy(() => import('@app/features/block-spreadsheet/SpreadsheetDemo'))
    )
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

registerComponent(
  'create-menu-demo',
  lazy(() => import('@app/features/command/debug/CreateMenuDemo'))
);
