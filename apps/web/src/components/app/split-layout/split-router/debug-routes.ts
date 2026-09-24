import { defineRoute } from '@app/lib/split-router';
import { DEV_MODE_ENV, LOCAL_ONLY } from '@core/constant/featureFlags';
import { lazy } from 'solid-js';

const debugComponentIds = [
  'ui',
  'icon-gallery',
  ...(LOCAL_ONLY
    ? [
        'theme-edit-3',
        'theme-debug',
        'core',
        'md',
        'data',
        'chat',
        'chat-attachment',
        'chat-tool',
        'http-stream',
        'static-markdown-stream',
        'resize',
        'notifications-playground',
        'props-debug',
        'entity-debug',
        'quick-access-list',
        'hotkey-debugger',
        'user-icon',
        'dynamic-ui',
        'agent-ui',
        'agent-replay',
        'agent-changes-ui',
      ]
    : []),
  ...(import.meta.env.DEV ? ['spreadsheet-demo'] : []),
  ...(DEV_MODE_ENV
    ? [
        'document-where-playground',
        'projection-playground',
        'md-parse',
        'md-builder',
        'collab-surface-demo',
      ]
    : []),
];

/** Keep debug views behind the registry's lazy imports and environment gates. */
export const debugRoutes = debugComponentIds.map((id) =>
  defineRoute({
    id: `view-${id}`,
    path: `debug/${id}`,
    aliases: [`component/${id}`],
    component: lazy(async () => {
      const { resolveComponent } = await import('../componentRegistry');
      return { default: () => resolveComponent(id).element() };
    }),
    search: '*' as const,
    externalSearch: id === 'ui' ? ['ui'] : [],
    claim: () => ({ namespace: 'component', id }),
  })
);
