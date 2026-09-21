import { parseAgentsRoute } from '@app/features/agents-view/core/route';
import { useSpreadsheetAccess } from '@app/features/block-spreadsheet/primitives/use-spreadsheet-access';
import type { EventEditorInitialValues } from '@app/features/calendar/components/composer/event-form-model';
import type { CalendarEvent } from '@app/features/calendar/types';
import { EmailCompose } from '@app/features/email-compose/email-compose';
import { NonMemberChannelPreview } from '@app/features/next-soup/soup-view/non-member-channel-preview';
import { ReminderEditorSplit } from '@app/features/reminders/ReminderEditorSplit';
import { globalSplitManager } from '@app/signal/splitLayout';
import { EventComposerSplit } from '@block-calendar/components/EventComposerSplit';
import { ChannelCompose } from '@block-channel/component/Compose';
import { ComposeSkill } from '@block-md/component/ComposeSkill';
import { ComposeTask } from '@block-md/component/ComposeTask';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { DEV_MODE_ENV, LOCAL_ONLY } from '@core/constant/featureFlags';
import type { ViewId } from '@core/types/view';
import EmptyStatePreviewIcon from '@design/empty-state-doc.svg';
import { EmptyStatePanel } from '@ui';
import { type JSXElement, lazy, onMount, Show } from 'solid-js';
import { useSplitPanelOrThrow } from './layoutUtils';
import { previewEmptyStateForContent } from './previewController';
import * as views from './split-router/app-views';
import {
  RedirectSplit,
  usePageViewTracking,
  withAuth,
} from './split-router/app-views';

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
registerComponent('home', (params) => <views.HomeView {...params} />);
registerComponent('getting-started', (params) => (
  <views.GettingStartedView {...params} />
));
registerComponent('inbox', (params) => <views.InboxRouteView {...params} />);
registerComponent('recent', (params) => <views.RecentView {...params} />);
registerComponent('activity', (params) => <views.ActivityView {...params} />);
registerComponent('reminders', (params) => <views.RemindersView {...params} />);
registerComponent('agents', (params) => <views.AgentsRouteView {...params} />);
registerComponent('mail', (params) => <views.MailView {...params} />);
registerComponent('documents', (params) => (
  <views.DriveRouteView {...params} />
));
registerComponent('tasks', (params) => <views.TasksRouteView {...params} />);
registerComponent('channels', (params) => (
  <views.ChannelsRouteView {...params} />
));
registerComponent('calls', (params) => <views.CallsView {...params} />);
registerComponent('companies', (params) => <views.CompaniesView {...params} />);
registerComponent('folders', (params) => <views.FoldersView {...params} />);
registerComponent('search', (params) => <views.SearchView {...params} />);
registerComponent('firehose', () => (
  <RedirectSplit to={{ type: 'component', id: 'activity' }} />
));
registerComponent('my-activity', () => (
  <RedirectSplit to={{ type: 'component', id: 'activity' }} />
));

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
registerComponent('settings', () => <views.SettingsView />);

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

  registerComponent(
    'linked-conversation',
    withAuth(lazy(() => import('@core/linked-conversation/debug/Demo')))
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
