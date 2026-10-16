import {
  createRoutesManifest,
  type Entry,
  type SplitRoutes,
} from '@app/lib/split-router';
import { paneRoute } from '@app/routes/app-route';
import {
  appRoute,
  companiesRoute,
  legacyContentRoute,
  notFoundRoute,
} from '@app/routes/routes';
import { createAppSplitRouterMiddleware } from '@components/app/split-layout/split-router/app-middleware';
import { createMacroMentionLinkResolver } from '@components/app/split-layout/split-router/mention-links';
import { describe, expect, it, vi } from 'vitest';
import { pipelineTab } from './core/navigation';
import type { CrmViewConfig } from './core/saved-view';
import { crmSearchCodec } from './crm-route';
import { encodeCrmViewParam } from './queries/saved-view-codec';

vi.mock('@components/app/split-layout/componentRegistry', () => ({
  resolveComponent: vi.fn(() => ({ type: 'mock-component' })),
}));
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

const pipelineId = '01a1212c-74e5-79bd-8767-0d4943d55b15';
const routes = createRoutesManifest({
  definitions: [
    {
      ...appRoute,
      children: [companiesRoute, legacyContentRoute, notFoundRoute],
    },
  ],
  defaultRoute: () => paneRoute({ id: companiesRoute.id, params: {} }),
} satisfies SplitRoutes);
const resolveMention = createMacroMentionLinkResolver(routes);

const crmViewLink = (view: CrmViewConfig) =>
  `${window.location.origin}/app/companies?crmView=${encodeCrmViewParam(view)}`;

describe('crm tab search params', () => {
  it.each([
    'active',
    'people',
    'hidden',
    pipelineTab(pipelineId),
    'list:favorites',
  ])('keeps the %s tab through the URL', (tab) => {
    const params = crmSearchCodec.serialize({ tab, pipeline: '', seek: '' });
    if (tab === 'active') {
      expect(params).toBeUndefined();
    } else {
      expect(params).toEqual({ tab: [tab] });
    }
    expect(crmSearchCodec.parse(params)).toEqual({
      value: { tab, pipeline: '', seek: '' },
      valid: true,
    });
  });
});

describe('pipeline links', () => {
  it('pastes a copied pipeline link as a mention of the pipeline', () => {
    expect(
      resolveMention(
        crmViewLink({ kind: 'crm', activeTab: pipelineTab(pipelineId) })
      )
    ).toEqual({ id: pipelineId, block: 'pipeline', params: {} });
  });

  it.each(['s0.crm.tab', 'crm.tab'])(
    'pastes a Customers link with %s as a mention of the pipeline',
    (key) => {
      expect(
        resolveMention(
          `${window.location.origin}/app/companies?${key}=${pipelineTab(pipelineId)}`
        )
      ).toEqual({ id: pipelineId, block: 'pipeline', params: {} });
    }
  );

  it.each([
    crmViewLink({ kind: 'crm', activeTab: 'active' }),
    crmViewLink({ kind: 'crm', activeTab: 'list:favorites' }),
    crmViewLink({ kind: 'crm', activeTab: pipelineTab('not-a-uuid') }),
    `${window.location.origin}/app/companies?crmView=garbage`,
    `${window.location.origin}/app/companies`,
    `${window.location.origin}/app/companies?s0.crm.tab=people`,
    `${window.location.origin}/app/companies?s0.crm.tab=${pipelineTab('not-a-uuid')}`,
    `${window.location.origin}/app/companies?crmView=${encodeCrmViewParam({ kind: 'crm', activeTab: 'active' })}&s0.crm.tab=${pipelineTab(pipelineId)}`,
  ])('leaves other Customers links as links: %s', (url) => {
    expect(resolveMention(url)).toBeUndefined();
  });

  it.each([false, true])(
    'opens a pipeline in Customers, on that pipeline (touch: %s)',
    (touch) => {
      const [redirectLegacy] = createAppSplitRouterMiddleware({
        isTouchDevice: () => touch,
      });
      const to: Entry = {
        id: 'entry',
        location: {
          route: paneRoute({
            id: legacyContentRoute.id,
            params: { type: 'pipeline', id: pipelineId },
          }),
        },
      };
      const open = () => {
        const result = redirectLegacy!({
          routes,
          from: undefined,
          to,
          path: `/pipeline/${pipelineId}`,
          cause: 'navigate',
          signal: new AbortController().signal,
          redirect: (path) => ({ type: 'redirect', to: path }),
          cancel: () => ({ type: 'cancel' }),
        });
        if (!result || result instanceof Promise || result.type !== 'redirect')
          throw new Error('Expected a redirect');
        return new URL(result.to, window.location.origin);
      };

      const first = open();
      expect(first.pathname).toBe('/companies');
      expect(first.searchParams.get('s0.crm.tab')).toBe(
        pipelineTab(pipelineId)
      );
      expect(first.searchParams.get('s0.crm.pipeline')).toBe(pipelineId);
      // Opening the same pipeline again is a new request.
      expect(open().searchParams.get('s0.crm.seek')).not.toBe(
        first.searchParams.get('s0.crm.seek')
      );
    }
  );
});
