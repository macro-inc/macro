import { ActivityRouteView } from '@app/features/activity/route';
import { parseAgentsRoute } from '@app/features/agents-view/core/route';
import { AgentsRouteView } from '@app/features/agents-view/route';
import { useSpreadsheetAccess } from '@app/features/block-spreadsheet/primitives/use-spreadsheet-access';
import type { EventEditorInitialValues } from '@app/features/calendar/components/composer/event-form-model';
import type { CalendarEvent } from '@app/features/calendar/types';
import { CalendarRouteView } from '@app/features/calendar-view/route';
import { ChannelsRouteView } from '@app/features/channels-view/route';
import { CompaniesRouteView } from '@app/features/companies/route';
import { DriveRouteView } from '@app/features/drive-view/route';
import { EmailCompose } from '@app/features/email-compose/email-compose';
import { MailRouteView } from '@app/features/email-view/route';
import { GettingStartedRouteView } from '@app/features/getting-started/route';
import { HomeRouteView } from '@app/features/home/route';
import { InboxRouteView } from '@app/features/inbox-view/route';
import {
  CallsRouteView,
  FoldersRouteView,
  RecentRouteView,
  SearchRouteView,
} from '@app/features/next-soup/route';
import { ReminderEditorSplit } from '@app/features/reminders/ReminderEditorSplit';
import { RemindersRouteView } from '@app/features/reminders/route';
import { SettingsRouteView } from '@app/features/settings/route';
import { TasksRouteView } from '@app/features/tasks-view/route';
import { EventComposerSplit } from '@block-calendar/components/EventComposerSplit';
import { ChannelCompose } from '@block-channel/component/Compose';
import { ComposeSkill } from '@block-md/component/ComposeSkill';
import { ComposeTask } from '@block-md/component/ComposeTask';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { DEV_MODE_ENV, LOCAL_ONLY } from '@core/constant/featureFlags';
import type { ViewId } from '@core/types/view';
import { type JSXElement, lazy, Show } from 'solid-js';
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

function registerComponent(
  name: string,
  factory: ComponentFactory,
  initialMeta?: ComponentMeta
) {
  const metaWithKind = initialMeta ? { kind: name, ...initialMeta } : undefined;
  REGISTRY.set(name, {
    factory,
    initialMeta: metaWithKind,
  });
}

type ResolvedComponent = {
  element: () => JSXElement;
  initialMeta?: ComponentMeta;
};

/**
 * A reminder view carries its reminder id in the id slot — `reminder-view~<id>`
 * — because component params are dropped on URL restore (see `contentUrlSegments`)
 * and split identity is keyed on the id, so each reminder needs a distinct one.
 */
const REMINDER_VIEW_PREFIX = 'reminder-view~';

export function resolveComponent(
  name: string,
  params?: ComponentParams
): ResolvedComponent {
  const registration = REGISTRY.get(name);
  if (!registration) {
    if (parseAgentsRoute(name)) {
      const base = REGISTRY.get('agents');
      if (base) {
        return {
          element: () => base.factory({ ...(params ?? {}), agentsRoute: name }),
          initialMeta: base.initialMeta,
        };
      }
    }
    if (name.startsWith(REMINDER_VIEW_PREFIX)) {
      const base = REGISTRY.get('reminder-view');
      if (base) {
        const reminderId = name.slice(REMINDER_VIEW_PREFIX.length);
        return {
          element: () => base.factory({ ...(params ?? {}), reminderId }),
          initialMeta: base.initialMeta,
        };
      }
    }
    throw new Error(`Component '${name}' not registered`);
  }
  return {
    element: () => registration.factory(params ?? {}),
    initialMeta: registration.initialMeta,
  };
}

registerComponent('unified-list', () => (
  <RedirectSplit to={{ type: 'component', id: 'inbox' }} />
));

// Compatibility factories for restored content and hosts outside a route outlet.
// App views themselves are composed by the application route layer.
registerComponent('home', () => <HomeRouteView />);
registerComponent('getting-started', () => <GettingStartedRouteView />);
registerComponent('inbox', () => <InboxRouteView />);
registerComponent('recent', () => <RecentRouteView />);
registerComponent('activity', () => <ActivityRouteView />);
registerComponent('reminders', () => <RemindersRouteView />);
registerComponent('agents', () => <AgentsRouteView />);
registerComponent('mail', () => <MailRouteView />);
registerComponent('documents', () => <DriveRouteView />);
registerComponent('tasks', () => <TasksRouteView />);
registerComponent('calendar', () => <CalendarRouteView />);
registerComponent('channels', () => <ChannelsRouteView />);
registerComponent('calls', () => <CallsRouteView />);
registerComponent('companies', () => <CompaniesRouteView />);
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
  return <EmailCompose draftId={draftID} initialTo={initialTo} />;
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
registerComponent('reminder-view', (params) => {
  usePageViewTracking('reminder-view');
  return <ReminderEditorSplit reminderId={params.reminderId as string} />;
});
registerComponent(
  'import-linear',
  lazy(() => import('@app/features/integrations/import-linear/ImportLinear'))
);
registerComponent('settings', () => <SettingsRouteView />);

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
    lazy(() => import('@app/features/agent-changes/debug/Gallery'))
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
          fallback={<RedirectSplit to={{ type: 'component', id: 'inbox' }} />}
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
