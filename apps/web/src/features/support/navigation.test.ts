import {
  createMemoryHistory,
  createMemoryPaneStore,
  createRoutesManifest,
  createSplitRouter,
  defineRoute,
  type Entry,
  type PaneId,
} from '@app/lib/split-router';
import { decodePanes, encodePanes } from '@app/lib/split-router/routes/codec';
import { createTestPolicy } from '@app/lib/split-router/tests/fixtures';
import { paneRoute } from '@app/routes/app-route';
import { createAppSplitRouterMiddleware } from '@components/app/split-layout/split-router/app-middleware';
import { resolveContentLocation } from '@components/app/split-layout/split-router/legacy-route';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { supportRoute, supportSearchCodec } from './navigation';

vi.mock('@core/constant/allBlocks', () => ({
  blocks: {},
  isBlockAlias: () => false,
  resolveBlockAlias: (value: string) => value,
}));
const routes = {
  definitions: [{ ...defineRoute({ id: 'app' }), children: [supportRoute] }],
  defaultRoute: () => paneRoute({ id: 'view-support', params: {} }),
};
const manifest = createRoutesManifest(routes);

function crmTicket(ticket: string, companyId: string) {
  return resolveContentLocation(manifest, {
    type: 'component',
    id: 'support',
    params: { initialTicket: ticket, companyId, contactId: 'contact-1' },
  });
}

describe('Support navigation', () => {
  it('opens the requested CRM ticket and preserves customer scope', () => {
    const location = crmTicket('ticket-1', 'company-1');
    expect(location.route.matches.at(-1)?.id).toBe('view-support');
    expect(supportSearchCodec.parse(location.search?.support).value).toEqual({
      ticket: 'ticket-1',
      companyId: 'company-1',
      contactId: 'contact-1',
    });
  });

  it('keeps two Support panes isolated through URL serialization', () => {
    const entries = ['1', '2'].map((id) => ({
      paneId: id as PaneId,
      entry: { id: id, location: crmTicket(`ticket-${id}`, `company-${id}`) },
    }));
    const url = encodePanes(manifest, entries, {
      path: '',
      search: '',
      hash: '',
    });
    const decoded = decodePanes(manifest, url);
    expect(
      decoded.panes.map(
        ({ entry }) =>
          supportSearchCodec.parse(entry.location.search?.support).value.ticket
      )
    ).toEqual(['ticket-1', 'ticket-2']);
    expect(
      decoded.panes.map(
        ({ entry }) =>
          supportSearchCodec.parse(entry.location.search?.support).value
            .companyId
      )
    ).toEqual(['company-1', 'company-2']);
  });

  it('upgrades a shared ticket URL into pane-local customer scope', async () => {
    const { router, dispose } = createRoot((dispose) => ({
      dispose,
      router: createSplitRouter({
        routes,
        policy: createTestPolicy().policy,
        history: createMemoryHistory(
          '/support?ticket=ticket-1&companyId=company-1&contactId=contact-1'
        ),
        paneStore: createMemoryPaneStore<Entry>(),
        middleware: createAppSplitRouterMiddleware({
          isTouchDevice: () => false,
        }),
      }),
    }));
    await router.settled();
    const entry = router.entry(router.panes()[0]!);
    expect(
      supportSearchCodec.parse(entry?.location.search?.support).value
    ).toEqual({
      ticket: 'ticket-1',
      companyId: 'company-1',
      contactId: 'contact-1',
    });
    router.dispose();
    dispose();
  });
});
