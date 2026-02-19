import { ChannelCompose } from '@block-channel/component/Compose';
import { ComposeTask } from '@block-md/component/ComposeTask';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { DEV_MODE_ENV, LOCAL_ONLY } from '@core/constant/featureFlags';
import type { ViewId } from '@core/types/view';
import { type JSXElement, lazy } from 'solid-js';
import { EmailCompose } from '../../../block-email/component/Compose';
import { SettingsPanelComponentWrapper } from '../settings/Settings';
import NotificationRoute from '@notifications/components/NotificationRoute';
import { SoupView } from '@app/component/next-soup/soup-view/soup-view';

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

registerComponent('unified-list', () => <SoupView />);
registerComponent('loading', () => <LoadingBlock />);
registerComponent('channel-compose', () => <ChannelCompose />);
registerComponent('email-compose', (params) => (
  <EmailCompose draftID={params?.draftID} />
));
registerComponent('task-compose', () => <ComposeTask />);
registerComponent(
  'import-linear',
  lazy(() => import('@app/component/import-linear/ImportLinear'))
);
registerComponent('settings', () => <SettingsPanelComponentWrapper />);
registerComponent('notification', () => <NotificationRoute />);

if (LOCAL_ONLY) {
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
    'custom-cursor',
    lazy(() => import('@app/component/CustomCursorTest'))
  );
  registerComponent(
    'resize',
    lazy(() => import('@core/internal/ResizeDemo'))
  );

  registerComponent(
    'onboarding',
    lazy(() => import('@app/component/Onboarding'))
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
}
