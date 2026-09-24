import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import * as path from '../path';
import {
  assertRouteState,
  assertSearchNamespacesAllowed,
  createRoutesManifest,
  decodeRoute,
  defineRoute,
  encodeRoute,
  filterRouteSearch,
  findRouteBranch,
  getExternalSearchKeys,
  getRouteClaim,
  getRouteSearchNamespaces,
  resolveRouteBranch,
  routeParams,
} from '../routes';
import type { SplitRouterEntry, SplitRouteState, SplitRoutes } from '../types';
import {
  decodeSplitRouterLocation,
  serializeSplitRouterLocation,
} from '../url';

afterEach(() => vi.restoreAllMocks());

describe('split routes manifests', () => {
  it('compiles once per explicit manifest, retaining original definition identity', () => {
    const compile = vi.spyOn(path, 'compileRoutePattern');
    const detail = defineRoute({ id: 'detail', path: 'document/:id' });
    const workspace = defineRoute({
      id: 'workspace',
      path: 'workspace',
      aliases: ['w'],
      children: [detail],
      search: ['workspace'],
    });
    const readDefinitions = vi.fn(() => [workspace]);
    const routes: SplitRoutes = {
      get definitions() {
        return readDefinitions();
      },
      basePath: '/app',
    };
    const manifest = createRoutesManifest(routes);
    expect(compile).toHaveBeenCalledTimes(2);
    expect(readDefinitions).toHaveBeenCalledOnce();
    expect(manifest.basePath).toEqual(['app']);

    for (const id of ['one', 'two', 'three']) {
      const entry = decodeSplitRouterLocation({
        routes: manifest,
        location: `/app/w/document/${id}`,
      }).entries[0]!;
      expect(
        serializeSplitRouterLocation({
          routes: manifest,
          entries: [entry],
          previous: '/',
        })
      ).toBe(`/app/workspace/document/${id}`);
      const branch = resolveRouteBranch(manifest, entry.location.route);
      expect(branch).toBe(findRouteBranch(manifest, 'detail'));
      expect(branch[0]?.definition).toBe(workspace);
      expect(branch[1]?.definition).toBe(detail);
      expect(getRouteSearchNamespaces(manifest, entry.location.route)).toEqual(
        new Set(['workspace'])
      );
      expect(getRouteClaim(manifest, entry.location.route)).toBeUndefined();
      expect(getExternalSearchKeys(manifest, [entry])).toEqual(new Set());
    }
    expect(readDefinitions).toHaveBeenCalledOnce();
    expect(compile).toHaveBeenCalledTimes(2);

    // Identical definitions do not imply shared runtime state across owners.
    const independent = createRoutesManifest(routes);
    expect(independent).not.toBe(manifest);
    expect(independent.byId).not.toBe(manifest.byId);
    expect(findRouteBranch(independent, 'detail')).not.toBe(
      findRouteBranch(manifest, 'detail')
    );
    expect(compile).toHaveBeenCalledTimes(4);
  });

  it('rejects unresolved runtime states without parsing schema outputs again', () => {
    const parse = vi.fn((value: string) => new Date(value));
    const manifest = createRoutesManifest({
      definitions: [
        defineRoute({
          id: 'day',
          path: 'day/:day',
          params: z.object({ day: z.string().transform(parse) }),
          serializeParams: ({ day }) => ({
            day: day.toISOString().slice(0, 10),
          }),
        }),
      ],
    });
    const entry = decodeRoute(manifest, ['day', '2026-01-02'])!;
    expect(() =>
      assertRouteState(manifest, entry.location.route)
    ).not.toThrow();
    expect(parse).toHaveBeenCalledTimes(1);
    for (const state of [
      undefined,
      null,
      {},
      { matches: [] },
      { matches: 'day' },
      { matches: [{ id: 'missing', params: {} }] },
      { matches: [{ id: 'day', params: [] }] },
      { matches: [{ id: 'day' }] },
    ]) {
      expect(() => assertRouteState(manifest, state)).toThrow(
        'Split route state'
      );
    }
  });

  it('validates the whole manifest before matching, including unused branches', () => {
    expect(() =>
      createRoutesManifest({
        definitions: [
          { id: 'home', path: 'home' },
          {
            id: 'other',
            path: 'other',
            children: [{ id: 'home', path: 'child' }],
          },
        ],
      })
    ).toThrow('Duplicate split route id "home"');
    expect(() =>
      createRoutesManifest({
        definitions: [{ id: 'bad', path: 'files/*rest/edit' }],
      })
    ).toThrow('must be the final segment');
  });

  it('keeps schema validation per match and falls through in declaration order', () => {
    const parseId = vi.fn((id: number) => id);
    const manifest = createRoutesManifest({
      definitions: [
        defineRoute({
          id: 'number',
          path: ':id',
          params: z.object({ id: z.coerce.number().transform(parseId) }),
        }),
        { id: 'text', path: '*rest' },
      ],
    });
    expect(parseId).not.toHaveBeenCalled();
    expect(routeParams(decodeRoute(manifest, ['42'])?.location.route)).toEqual({
      id: 42,
    });
    expect(routeParams(decodeRoute(manifest, ['43'])?.location.route)).toEqual({
      id: 43,
    });
    expect(parseId).toHaveBeenCalledTimes(2);
    expect(
      decodeRoute(manifest, ['text'])?.location.route?.matches[0]?.id
    ).toBe('text');
  });

  it('serializes transformed params per entry through the node codec', () => {
    const serializeParams = vi.fn(({ day }: { day: Date }) => ({
      day: day.toISOString().slice(0, 10),
    }));
    const manifest = createRoutesManifest({
      definitions: [
        defineRoute({
          id: 'calendar',
          path: 'calendar/:day',
          params: z.object({ day: z.coerce.date() }),
          serializeParams,
        }),
      ],
    });
    expect(serializeParams).not.toHaveBeenCalled();
    for (const day of ['2026-01-02', '2026-02-03']) {
      const entry = decodeRoute(manifest, ['calendar', day])!;
      expect(encodeRoute(manifest, entry)).toEqual(['calendar', day]);
      expect(serializeParams).toHaveBeenLastCalledWith({
        day: new Date(`${day}T00:00:00.000Z`),
      });
    }
    expect(serializeParams).toHaveBeenCalledTimes(2);
  });

  it('keeps primitive params usable without a custom serializer', () => {
    const manifest = createRoutesManifest({
      definitions: [
        defineRoute({
          id: 'page',
          path: 'page/:id',
          params: z.object({ id: z.coerce.number() }),
        }),
      ],
    });
    const node = manifest.byId.get('page')!;
    const params = node.params.parse({ id: '42' })!;
    expect(params).toEqual({ id: 42 });
    expect(node.pattern.format(node.params.serialize(params))).toEqual([
      'page',
      '42',
    ]);
    expect(node.params.parse({ id: 'invalid' })).toBeUndefined();
  });

  it('retains optional-parameter backtracking into children and canonical branch formatting', () => {
    const manifest = createRoutesManifest({
      definitions: [
        {
          id: 'workspace',
          path: 'workspace/:workspaceId?',
          aliases: ['w/:workspaceId?'],
          children: [
            { id: 'settings', path: 'settings/:tab', aliases: ['s/:tab'] },
          ],
        },
      ],
    });
    const entry = decodeRoute(manifest, ['w', 's', 'account'])!;
    expect(entry.location.route?.matches).toEqual([
      { id: 'workspace', params: {} },
      { id: 'settings', params: { tab: 'account' } },
    ]);
    expect(encodeRoute(manifest, entry)).toEqual([
      'workspace',
      'settings',
      'account',
    ]);
  });

  it('tries later aliases after schema rejection but stops after the first valid match', () => {
    const validate = vi.fn((params: { value: string }) => params);
    const manifest = createRoutesManifest({
      definitions: [
        defineRoute({
          id: 'item',
          path: 'item/:invalid',
          aliases: ['item/:value', ':prefix/:value'],
          params: z
            .union([
              z.object({ invalid: z.string() }).refine(() => false),
              z.object({ value: z.string() }),
              z.object({ prefix: z.string(), value: z.string() }),
            ])
            .transform((params) =>
              'value' in params
                ? validate({ value: params.value })
                : { value: params.invalid }
            ),
        }),
      ],
    });
    expect(
      routeParams(decodeRoute(manifest, ['item', 'one'])?.location.route)
    ).toEqual({ value: 'one' });
    expect(validate).toHaveBeenCalledTimes(1);
  });

  it('evaluates deepest-first claims with current merged params and ancestor fallback', () => {
    const parentClaim = vi.fn(({ workspaceId }: { workspaceId: string }) => ({
      namespace: 'workspace',
      id: workspaceId,
    }));
    const childClaim = vi.fn(
      ({ workspaceId, id }: { workspaceId: string; id: string }) =>
        id === 'none'
          ? undefined
          : { namespace: 'document', id: `${workspaceId}/${id}` }
    );
    const manifest = createRoutesManifest({
      definitions: [
        {
          id: 'workspace',
          path: 'workspace/:workspaceId',
          claim: parentClaim,
          children: [{ id: 'detail', path: 'document/:id', claim: childClaim }],
        },
      ],
    });
    expect(parentClaim).not.toHaveBeenCalled();
    expect(childClaim).not.toHaveBeenCalled();
    const first = decodeRoute(manifest, [
      'workspace',
      'one',
      'document',
      'first',
    ])!;
    expect(getRouteClaim(manifest, first.location.route)).toEqual({
      namespace: 'document',
      id: 'one/first',
    });
    expect(parentClaim).not.toHaveBeenCalled();
    const second = decodeRoute(manifest, [
      'workspace',
      'two',
      'document',
      'none',
    ])!;
    expect(getRouteClaim(manifest, second.location.route)).toEqual({
      namespace: 'workspace',
      id: 'two',
    });
    expect(childClaim).toHaveBeenLastCalledWith({
      workspaceId: 'two',
      id: 'none',
    });
    expect(parentClaim).toHaveBeenLastCalledWith({
      workspaceId: 'two',
      id: 'none',
    });
  });

  it('reuses inherited search ownership but evaluates dynamic external search per entry', () => {
    const externalSearch = vi.fn((entry: SplitRouterEntry) => [
      String(routeParams(entry.location.route).id),
    ]);
    const manifest = createRoutesManifest({
      globalSearch: ['global'],
      definitions: [
        {
          id: 'workspace',
          path: 'workspace',
          search: ['workspace'],
          externalSearch: ['action'],
          children: [
            {
              id: 'detail',
              path: 'document/:id',
              search: ['detail'],
              externalSearch,
            },
            { id: 'legacy', path: 'legacy', search: '*' },
          ],
        },
      ],
    });
    expect(externalSearch).not.toHaveBeenCalled();
    const first = decodeRoute(manifest, ['workspace', 'document', 'one'])!;
    const second = decodeRoute(manifest, ['workspace', 'document', 'two'])!;
    expect(getRouteSearchNamespaces(manifest, first.location.route)).toBe(
      getRouteSearchNamespaces(manifest, second.location.route)
    );
    expect(getRouteSearchNamespaces(manifest, first.location.route)).toEqual(
      new Set(['workspace', 'detail'])
    );
    expect([...getExternalSearchKeys(manifest, [first])]).toEqual([
      'global',
      'action',
      'one',
    ]);
    expect([...getExternalSearchKeys(manifest, [second])]).toEqual([
      'global',
      'action',
      'two',
    ]);
    expect(externalSearch).toHaveBeenCalledTimes(2);
    const search = {
      workspace: { sort: ['name'] },
      detail: { mode: ['edit'] },
      extra: { x: ['1'] },
    };
    expect(filterRouteSearch(manifest, first.location.route, search)).toEqual({
      workspace: search.workspace,
      detail: search.detail,
    });
    const legacy = decodeRoute(manifest, ['workspace', 'legacy'])!;
    expect(filterRouteSearch(manifest, legacy.location.route, search)).toBe(
      search
    );
  });

  it('validates namespace writes against inherited ownership or the legacy wildcard', () => {
    const manifest = createRoutesManifest({
      definitions: [
        {
          id: 'parent',
          path: 'parent',
          search: ['parent'],
          children: [{ id: 'child', path: 'child', search: ['child'] }],
        },
        { id: 'legacy', path: 'legacy', search: '*' },
      ],
    });
    const child = decodeRoute(manifest, ['parent', 'child'])!.location.route;
    expect(() =>
      assertSearchNamespacesAllowed(manifest, child, ['parent', 'child'])
    ).not.toThrow();
    expect(() =>
      assertSearchNamespacesAllowed(manifest, child, ['other'])
    ).toThrow('Split route does not own search namespace "other"');
    const legacy = decodeRoute(manifest, ['legacy'])!.location.route;
    expect(() =>
      assertSearchNamespacesAllowed(manifest, legacy, ['other'])
    ).not.toThrow();
    for (const route of [child, legacy]) {
      expect(() =>
        assertSearchNamespacesAllowed(manifest, route, ['constructor'])
      ).toThrow('Invalid split search namespace "constructor"');
    }
  });

  it('rejects known IDs in the wrong branch rather than keeping a partial match', () => {
    const root = {
      id: 'root',
      path: 'root',
      children: [{ id: 'child', path: 'child' }],
    };
    const other = {
      id: 'other',
      path: 'other',
      children: [{ id: 'other-child', path: 'child' }],
    };
    const manifest = createRoutesManifest({ definitions: [root, other] });
    const invalid: SplitRouteState = {
      matches: [
        { id: 'root', params: {} },
        { id: 'other-child', params: {} },
      ],
    };
    expect(() => resolveRouteBranch(manifest, invalid)).toThrow(
      'invalid match branch'
    );
    expect(() => assertRouteState(manifest, invalid)).toThrow(
      'invalid match branch'
    );
    expect(() =>
      encodeRoute(manifest, { location: { route: invalid } })
    ).toThrow('invalid match branch');
    expect(() =>
      resolveRouteBranch(manifest, { matches: [{ id: 'child', params: {} }] })
    ).toThrow('invalid match branch');
  });
});
