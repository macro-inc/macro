import { useAnalytics } from '@app/component/analytics-context';
import { getViewPreset } from '@app/component/app-sidebar/soup-filter-presets';
import { Home } from '@app/component/home';
import { queryStateFrom } from '@app/component/next-soup/filters/filter-store';
import type { SetPredicatesInput } from '@app/component/next-soup/filters/filter-store/predicates-store';
import { mergeQuery } from '@app/component/next-soup/filters/filter-store/query-store';
import type { Query } from '@app/component/next-soup/filters/filter-store/types';
import { SoupView } from '@app/component/next-soup/soup-view/soup-view';
import { ChannelCompose } from '@block-channel/component/Compose';
import { ComposeTask } from '@block-md/component/ComposeTask';
import { useIsAuthenticated } from '@core/auth';
import { LoadingBlock } from '@core/component/LoadingBlock';
import {
  DEV_MODE_ENV,
  ENABLE_CRM,
  LOCAL_ONLY,
} from '@core/constant/featureFlags';
import { useUserContext } from '@core/context/user';
import type { ViewId } from '@core/types/view';
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

type ComponentFactory = (params?: Record<string, any>) => JSXElement;

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

function registerComponent<T extends Omit<ComponentMeta, 'kind'>>(
  name: string,
  factory: ComponentFactory,
  initialMeta?: T
) {
  const metaWithKind = initialMeta ? { kind: name, ...initialMeta } : undefined;
  REGISTRY.set(name, { factory, initialMeta: metaWithKind as ComponentMeta });
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
  'home',
  withAuth(() => {
    usePageViewTracking('home');
    return <Home />;
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

registerComponent(
  'agents',
  withAuth(() => {
    usePageViewTracking('agents');
    const user = useUserContext();
    const preset = getViewPreset('agents', undefined, {
      userId: user.userId(),
      email: user.email(),
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
      email: user.email(),
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
      email: user.email(),
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
    if (!ENABLE_CRM) {
      return <RedirectSplit to={{ type: 'component', id: 'inbox' }} />;
    }
    usePageViewTracking('companies');
    const preset = getViewPreset('companies');
    return (
      <SoupView
        viewName="Companies"
        initialFilters={preset?.filters}
        initialClientFilters={preset?.clientFilters}
        initialGroupBy={preset?.groupBy}
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
    lazy(() => import('@app/component/HotkeyDebugger'))
  );

  registerComponent(
    'user-icon',
    lazy(() => import('@core/internal/UserIconDemo'))
  );

  registerComponent(
    'dynamic-ui',
    lazy(() => import('@app/component/dynamic-ui/Gallery'))
  );
}

if (DEV_MODE_ENV) {
  registerComponent(
    'document-where-playground',
    withAuth(
      lazy(
        () => import('@app/component/next-soup/debug/DocumentWherePlayground')
      )
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
}

// Icon gallery
registerComponent(
  'icon-gallery',
  lazy(() => import('@core/internal/IconGallery'))
);
