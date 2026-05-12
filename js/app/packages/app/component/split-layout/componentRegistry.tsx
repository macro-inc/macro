import { useAnalytics } from '@app/component/analytics-context';
import { getViewPreset } from '@app/component/app-sidebar/soup-filter-presets';
import type { SetPredicatesInput } from '@app/component/next-soup/filters/filter-store/predicates-store';
import type { Query } from '@app/component/next-soup/filters/filter-store/types';
import { SoupView } from '@app/component/next-soup/soup-view/soup-view';
import { ChannelCompose } from '@block-channel/component/Compose';
import { ComposeTask } from '@block-md/component/ComposeTask';
import { useIsAuthenticated } from '@core/auth';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { DEV_MODE_ENV, LOCAL_ONLY } from '@core/constant/featureFlags';
import { useUserContext } from '@core/context/user';
import type { ViewId } from '@core/types/view';
import NotificationRoute from '@notifications/components/NotificationRoute';
import { useAutomationEntities } from '@queries/agent-schedule/entities';
import { type Component, type JSXElement, lazy, onMount, Show } from 'solid-js';
import { EmailCompose } from '../../../block-email/component/compose/Compose';
import { SettingsPanelComponentWrapper } from '../settings/Settings';
import type { SplitContent } from './layoutManager';
import { useSplitPanelOrThrow } from './layoutUtils';

function usePageViewTracking(pageTitle: string) {
  const analytics = useAnalytics();
  onMount(() => {
    analytics.pageView(pageTitle);
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

export type ComponentFactory = (params?: Record<string, any>) => JSXElement;

export type UnifiedListMeta = {
  kind: 'unified-list';
  viewId: ViewId;
};

export type ComponentMeta = UnifiedListMeta | { kind?: undefined };

export type ComponentMetaMap = {
  'unified-list': UnifiedListMeta;
};

type ComponentRegistration = {
  factory: ComponentFactory;
  initialMeta?: ComponentMeta;
};

const REGISTRY = new Map<string, ComponentRegistration>();

export function registerComponent<T extends Omit<ComponentMeta, 'kind'>>(
  name: string,
  factory: ComponentFactory,
  initialMeta?: T
) {
  const metaWithKind = initialMeta ? { kind: name, ...initialMeta } : undefined;
  REGISTRY.set(name, { factory, initialMeta: metaWithKind as ComponentMeta });
}

export type ResolvedComponent = {
  element: () => JSXElement;
  initialMeta?: ComponentMeta;
};

// Similar to SolidRouter's `<Navigate />` but for splits
export function RedirectSplit(props: { to: SplitContent }) {
  const panel = useSplitPanelOrThrow();

  onMount(() => {
    panel.handle.replace({ next: props.to });
  });

  return null;
}

export function resolveComponent(
  name: string,
  params?: Record<string, any>
): ResolvedComponent {
  const registration = REGISTRY.get(name);
  if (!registration) throw new Error(`Component '${name}' not registered`);
  return {
    element: () => registration.factory(params),
    initialMeta: registration.initialMeta,
  };
}

registerComponent('unified-list', () => (
  <RedirectSplit to={{ type: 'component', id: 'inbox' }} />
));

/** BEGIN - APP ROUTES */
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
        disableLocalSearch
      />
    );
  })
);

registerComponent(
  'agents',
  withAuth(() => {
    usePageViewTracking('agents');
    const user = useUserContext();
    const preset = getViewPreset('agents', undefined, {
      userId: user.userId(),
      email: user.email(),
    });
    const automationEntities = useAutomationEntities();
    return (
      <SoupView
        viewName="Agents"
        initialFilters={preset?.filters}
        initialClientFilters={preset?.clientFilters}
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
      />
    );
  })
);

registerComponent(
  'documents',
  withAuth(() => {
    usePageViewTracking('documents');
    const user = useUserContext();
    const preset = getViewPreset('documents', undefined, {
      userId: user.userId(),
      email: user.email(),
    });
    return (
      <SoupView
        viewName="Documents"
        initialFilters={preset?.filters}
        initialClientFilters={preset?.clientFilters}
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
      email: user.email(),
    });
    return (
      <SoupView
        viewName="Tasks"
        initialFilters={preset?.filters}
        initialClientFilters={preset?.clientFilters}
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
      email: user.email(),
    });
    return (
      <SoupView
        viewName="Folders"
        initialFilters={preset?.filters}
        initialClientFilters={preset?.clientFilters}
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
    const hasExplicitParams =
      params.initialQuery !== undefined ||
      params.initialFilters !== undefined ||
      params.initialClientFilters !== undefined;
    return (
      <SoupView
        viewName="Search"
        initialFilters={params.initialFilters ?? preset?.filters}
        initialClientFilters={
          params.initialClientFilters ?? preset?.clientFilters
        }
        initialSearchText={params.initialQuery}
        skipPersistedState={hasExplicitParams}
      />
    );
  })
);
/** END - APP ROUTES */

registerComponent('loading', () => <LoadingBlock />);
registerComponent('channel-compose', () => {
  usePageViewTracking('channel-compose');
  return <ChannelCompose />;
});
registerComponent('email-compose', (params) => {
  usePageViewTracking('email-compose');
  return <EmailCompose draftID={params?.draftID} />;
});
registerComponent('task-compose', (params) => {
  usePageViewTracking('task-compose');
  return <ComposeTask {...params} />;
});
registerComponent(
  'import-linear',
  lazy(() => import('@app/component/import-linear/ImportLinear'))
);
registerComponent('settings', () => <SettingsPanelComponentWrapper />);
registerComponent('notification', () => <NotificationRoute />);
registerComponent(
  'welcome',
  lazy(
    () => import('@app/component/interactive-onboarding/InteractiveOnboarding')
  )
);

if (LOCAL_ONLY) {
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
    'new-form-primitives',
    lazy(
      () => import('@core/component/FormControls/debug/NewFormPrimitivesDemo')
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
    'properties-debug',
    lazy(() => import('@core/component/Properties/debug/PropertiesDebug'))
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
    lazy(() => import('@app/component/HotkeyDebugger'))
  );

  registerComponent(
    'user-icon',
    lazy(() => import('@core/internal/UserIconDemo'))
  );
}

if (DEV_MODE_ENV) {
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
}

// Icon gallery
registerComponent(
  'icon-gallery',
  lazy(() => import('@core/internal/IconGallery'))
);
