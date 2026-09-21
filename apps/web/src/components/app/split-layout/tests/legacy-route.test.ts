import { agentsRouteId } from '@app/features/agents-view/core/route';
import {
  createRoutesManifest,
  decodeRoute,
  defineRoute,
  encodeRoute,
} from '@app/lib/split-router/routes';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { SplitContent } from '../layoutManager';
import { appSplitRoutes } from '../split-router/app-routes';
import {
  legacySplitRoute,
  resolveContentLocation,
  splitContentFromLocation,
} from '../split-router/legacy-route';

vi.mock('../split-router/app-views', () => ({
  withLaunchParams: () => () => null,
}));

vi.mock('@core/constant/allBlocks', () => ({
  isBlockAlias: () => false,
  resolveBlockAlias: (type: string) => type,
}));

const routes = createRoutesManifest({
  definitions: [
    defineRoute({
      id: 'drive',
      path: 'drive',
      search: ['drive'],
      children: [
        {
          id: 'folder',
          path: 'folder/:id',
          params: z.object({ id: z.string().min(1) }),
        },
      ],
    }),
    defineRoute({
      id: 'settings',
      path: 'settings/:tab',
      params: z.object({ tab: z.enum(['account', 'billing']) }),
    }),
    legacySplitRoute,
  ],
});
const content: SplitContent = { type: 'component', id: 'documents' };

describe('legacy router location boundary', () => {
  it.each([
    {
      type: 'chat',
      routeId: 'agent-chats',
      path: ['agents', 'chat', 'conversation-1'],
    },
    {
      type: 'agent_session',
      routeId: 'agents',
      path: ['agents', 'conversation-1'],
    },
  ] as const)(
    'keeps $type conversations under Agents across URL and saved-layout round trips',
    ({ type, routeId, path }) => {
      const manifest = createRoutesManifest(appSplitRoutes);
      const conversation: SplitContent = {
        type: 'component',
        id: agentsRouteId({
          mode: 'chat',
          conversation: { type, id: 'conversation-1' },
        }),
      };
      for (const restored of [
        conversation,
        {
          ...conversation,
          entryMetadata: {
            route: {
              matches: [{ id: routeId, params: { id: 'conversation-1' } }],
            },
          },
        },
      ]) {
        const location = resolveContentLocation(manifest, restored);
        expect(encodeRoute(manifest, { location })).toEqual(path);
        const decoded = decodeRoute(manifest, [...path]);
        expect(decoded?.location).toEqual(location);
        expect(splitContentFromLocation(decoded!.location)).toEqual(
          conversation
        );
      }
    }
  );

  it('canonicalizes old agent-chats links without changing conversation identity', () => {
    const manifest = createRoutesManifest(appSplitRoutes);
    const oldLink = decodeRoute(manifest, ['agent-chats', 'chat-1']);
    const canonical = decodeRoute(manifest, ['agents', 'chat', 'chat-1']);
    expect(oldLink).toEqual(canonical);
    expect(encodeRoute(manifest, oldLink!)).toEqual([
      'agents',
      'chat',
      'chat-1',
    ]);
  });

  it.each([
    undefined,
    null,
    {},
    { matches: [] },
    { matches: 'drive' },
    { matches: [{ id: 'missing', params: {} }] },
    { matches: [{ id: 'folder', params: { id: 'one' } }] },
    {
      matches: [
        { id: 'drive', params: {} },
        { id: 'settings', params: { tab: 'account' } },
      ],
    },
    {
      matches: [
        { id: 'drive', params: {} },
        { id: 'folder', params: { id: '' } },
      ],
    },
    { matches: [{ id: 'settings', params: { tab: 'invalid' } }] },
  ])(
    'recovers unresolved metadata from content while preserving owned search: %j',
    (route) => {
      expect(
        resolveContentLocation(routes, {
          ...content,
          entryMetadata: {
            route,
            search: {
              drive: { sort: ['name'] },
              other: { ignored: ['value'] },
            },
          },
        })
      ).toEqual({
        route: { matches: [{ id: 'drive', params: {} }] },
        search: { drive: { sort: ['name'] } },
      });
    }
  );

  it('derives routes when metadata is absent, unrelated, or search-only', () => {
    for (const entryMetadata of [
      undefined,
      {},
      { source: 'old-layout' },
      'old-layout',
    ]) {
      expect(
        resolveContentLocation(routes, { ...content, entryMetadata })
      ).toEqual({ route: { matches: [{ id: 'drive', params: {} }] } });
    }
    expect(
      resolveContentLocation(routes, {
        ...content,
        entryMetadata: { search: { drive: { sort: ['name'] } } },
      }).search
    ).toEqual({ drive: { sort: ['name'] } });
  });

  it('retains valid nested routes and sanitizes persisted query fields', () => {
    const route = {
      matches: [
        { id: 'drive', params: {} },
        { id: 'folder', params: { id: 'one' } },
      ],
    };
    const metadata = {
      route,
      search: { drive: { sort: ['name'], constructor: ['unsafe'] } },
    };
    expect(
      resolveContentLocation(routes, { ...content, entryMetadata: metadata })
    ).toEqual({
      route,
      search: { drive: { sort: ['name'] } },
    });
    expect(metadata.search.drive.constructor).toEqual(['unsafe']);
  });

  it('preserves legacy content routes and wildcard search compatibility', () => {
    expect(
      resolveContentLocation(routes, {
        type: 'md',
        id: 'document-1',
        entryMetadata: { search: { editor: { mode: ['edit'] } } },
      })
    ).toEqual({
      route: {
        matches: [
          { id: 'legacy-content', params: { type: 'md', id: 'document-1' } },
        ],
      },
      search: { editor: { mode: ['edit'] } },
    });
  });

  it('serializes runtime params before parsing rather than feeding schema outputs into schemas', () => {
    const dateRoutes = createRoutesManifest({
      definitions: [
        defineRoute({
          id: 'day',
          path: 'day/:date',
          params: z.object({
            date: z.string().transform((value) => new Date(value)),
          }),
          serializeParams: ({ date }) => ({
            date: date.toISOString().slice(0, 10),
          }),
        }),
        legacySplitRoute,
      ],
    });
    const date = new Date('2026-01-02T00:00:00.000Z');
    expect(
      resolveContentLocation(dateRoutes, {
        type: 'md',
        id: 'document-1',
        entryMetadata: {
          route: { matches: [{ id: 'day', params: { date } }] },
        },
      }).route.matches[0].params
    ).toEqual({ date });
  });
});
