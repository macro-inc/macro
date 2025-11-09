import { ChannelCompose } from '@block-channel/component/Compose';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { DEV_MODE_ENV, LOCAL_ONLY } from '@core/constant/featureFlags';
import { type JSXElement, lazy } from 'solid-js';
import { EmailCompose } from '../../../block-email/component/Compose';
import { Soup } from '../Soup';

export type ComponentFactory = (params?: Record<string, any>) => JSXElement;

const REGISTRY = new Map<
  string,
  (params?: Record<string, any>) => JSXElement
>();

export function registerComponent(name: string, factory: ComponentFactory) {
  REGISTRY.set(name, factory);
}

export function resolveComponent(name: string, params?: Record<string, any>) {
  const factory = REGISTRY.get(name);
  if (!factory) throw new Error(`Component '${name}' not registered`);
  return () => factory(params);
}

registerComponent('unified-list', () => <Soup />);
registerComponent('loading', () => <LoadingBlock />);
registerComponent('channel-compose', () => <ChannelCompose />);
registerComponent('email-compose', () => <EmailCompose />);

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
    'md-parse',
    lazy(
      () =>
        import(
          '@core/component/LexicalMarkdown/component/debug/MarkdownParseTestPage'
        )
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
    'onboarding',
    lazy(() => import('@app/component/Onboarding'))
  );
}

if (DEV_MODE_ENV) {
  // NOTE (seamus) : putting pixel icons on dev/staging for aidan
  registerComponent(
    'pixel-icon',
    lazy(() => import('@core/internal/PixelArtIconDemo'))
  );
}
