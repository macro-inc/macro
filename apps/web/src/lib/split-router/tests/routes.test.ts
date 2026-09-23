import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import {
  createRoutesManifest,
  decodeRoute,
  defineRoute,
  defineRoutes,
  encodeRoute,
  findRouteBranch,
  getExternalSearchKeys,
  getRouteClaim,
  routeParams,
  validateRouteParams,
  validateSplitRoutes,
} from '../routes';
import type {
  InferSplitRouteBranchParams,
  InferSplitRouteNavigationParams,
  InferSplitRouteParams,
  SplitRoutes,
} from '../types';

const documentClaim = ({ documentId }: { documentId: string }) => ({
  namespace: 'document',
  id: documentId,
});

const driveRoute = defineRoute({
  id: 'drive',
  path: 'drive',
  aliases: ['files'],
  params: z.object({}),
  search: ['drive'],
  externalSearch: ['action'],
  children: [
    {
      id: 'drive-folder',
      path: 'folder/:folderId',
      params: z.object({ folderId: z.string() }),
      children: [
        {
          id: 'drive-folder-detail',
          path: 'pdf/:documentId',
          params: z.object({ documentId: z.string() }),
          claim: documentClaim,
          externalSearch: ['preview'],
        },
      ],
    },
    {
      id: 'drive-detail',
      path: 'pdf/:documentId',
      params: z.object({ documentId: z.string() }),
      claim: documentClaim,
      externalSearch: ['preview'],
    },
  ],
});

const routes = createRoutesManifest({
  definitions: [
    driveRoute,
    {
      id: 'legacy',
      path: 'legacy/:id',
      params: z.object({ id: z.string() }),
    },
  ],
  globalSearch: ['referral_code'],
});

describe('split route parameter schemas', () => {
  const issueRoute = defineRoute({
    id: 'issue',
    path: 'issue/:issueId',
    params: z.object({ issueId: z.coerce.number().int().positive() }),
    remountKey: ({ issueId }) => issueId.toFixed(0),
  });

  it('coerces URL strings to typed runtime values', () => {
    const entry = decodeRoute(
      createRoutesManifest({ definitions: [issueRoute] }),
      ['issue', '42']
    );

    expect(routeParams(entry?.location.route)).toEqual({ issueId: 42 });
    expectTypeOf(issueRoute.id).toEqualTypeOf<'issue'>();
    expectTypeOf<InferSplitRouteParams<typeof issueRoute>>().toEqualTypeOf<{
      issueId: number;
    }>();
  });

  it('rejects invalid values', () => {
    expect(
      validateRouteParams(issueRoute.params, { issueId: 'not-a-number' })
    ).toBeUndefined();
  });

  it('rejects asynchronous schemas', () => {
    const schema = z.object({ id: z.string() }).transform(async ({ id }) => ({
      id,
    }));

    expect(() => validateRouteParams(schema, { id: 'one' })).toThrow(
      'must be synchronous'
    );
  });
});

function assertInvalidRouteDeclarations() {
  // @ts-expect-error Invalid callbacks are rejected by the declaration boundary.
  defineRoutes({ definitions: [{ id: 'bad', path: 'bad', claim: 42 }] });
  defineRoutes({
    // @ts-expect-error Route parameter schemas must produce objects.
    definitions: [defineRoute({ id: 'bad', path: 'bad', params: z.string() })],
  });
  // @ts-expect-error Schema keys must match the path parameter keys.
  defineRoute({
    id: 'mismatched-key',
    path: 'issue/:issueId',
    params: z.object({ id: z.string() }),
  });
  // @ts-expect-error Schema keys must cover every alias parameter key.
  defineRoute({
    id: 'mismatched-alias-key',
    path: 'issue/:issueId',
    aliases: ['issues/:legacyId'],
    params: z.object({ issueId: z.string() }),
  });
  // @ts-expect-error Optional path parameters require optional schema input.
  defineRoute({
    id: 'mismatched-optionality',
    path: 'issue/:issueId?',
    params: z.object({ issueId: z.string() }),
  });
  // @ts-expect-error Schemas cannot require input that the path never provides.
  defineRoute({
    id: 'extra-required-input',
    path: 'issue/:issueId',
    params: z.object({ issueId: z.string(), revision: z.string() }),
  });
  // @ts-expect-error Nested declarations receive the same schema validation.
  defineRoutes({
    definitions: [
      {
        id: 'parent',
        path: 'parent',
        children: [
          {
            id: 'mismatched-child',
            path: ':childId',
            params: z.object({ id: z.string() }),
          },
        ],
      },
    ],
  });
}

describe('typed route trees', () => {
  it('checks declaration contracts without widening node inference', () => {
    expectTypeOf(assertInvalidRouteDeclarations).toBeFunction();
  });
  it('preserves declaration and schema identity while typing descendant ancestry', () => {
    const declarations = {
      definitions: [driveRoute] as const,
      globalSearch: ['referral_code'] as const,
    };
    const tree = defineRoutes(declarations);
    const detail = tree.definitions[0].children[0].children[0];
    expect(tree).toBe(declarations);
    expect(tree.definitions[0]).toBe(driveRoute);
    expect(detail).toBe(driveRoute.children[0].children[0]);
    expect(detail.params).toBe(driveRoute.children[0].children[0].params);
    expect(createRoutesManifest(tree).byId.get(detail.id)?.definition).toBe(
      detail
    );
    expectTypeOf(tree).toExtend<SplitRoutes>();
    expectTypeOf<InferSplitRouteParams<typeof driveRoute>>().toEqualTypeOf<
      z.output<typeof driveRoute.params>
    >();
    expectTypeOf(detail.id).toEqualTypeOf<'drive-folder-detail'>();
    expectTypeOf<InferSplitRouteParams<typeof detail>>().toEqualTypeOf<{
      documentId: string;
    }>();
    expectTypeOf<InferSplitRouteBranchParams<typeof detail>>().toEqualTypeOf<{
      folderId: string;
      documentId: string;
    }>();
  });

  it('types descendants directly from a named definition before assembly', () => {
    const detail = driveRoute.children[0].children[0];
    expectTypeOf<InferSplitRouteParams<typeof detail>>().toEqualTypeOf<{
      documentId: string;
    }>();
    expectTypeOf<
      InferSplitRouteNavigationParams<typeof detail>
    >().toEqualTypeOf<{
      folderId: string;
      documentId: string;
    }>();
    expectTypeOf<InferSplitRouteBranchParams<typeof detail>>().toEqualTypeOf<{
      folderId: string;
      documentId: string;
    }>();
    const definition = {
      id: 'named',
      path: 'named/:id',
      children: [{ id: 'child', path: ':childId' }],
    } as const;
    const named = defineRoute(definition);
    expect(named).toBe(definition);
    expect(named.children[0]).toBe(definition.children[0]);
    expectTypeOf<
      InferSplitRouteNavigationParams<(typeof named.children)[0]>
    >().toEqualTypeOf<{ id: string; childId: string }>();
    const tree = defineRoutes({ definitions: [named] });
    expect(tree.definitions[0]).toBe(named);
  });

  it('rebinds ancestry when an existing reference is composed into another tree', () => {
    const tree = defineRoutes({ definitions: [driveRoute] });
    const detail = tree.definitions[0].children[0].children[0];
    const rebound = defineRoutes({ definitions: [detail] });
    const root = rebound.definitions[0];
    expect(root).toBe(detail);
    expectTypeOf<InferSplitRouteBranchParams<typeof root>>().toEqualTypeOf<{
      documentId: string;
    }>();
    expectTypeOf<InferSplitRouteNavigationParams<typeof root>>().toEqualTypeOf<{
      documentId: string;
    }>();
    const widened: SplitRoutes = tree;
    const redefined = defineRoutes(widened);
    expectTypeOf(redefined.definitions[0]?.children).toEqualTypeOf<
      SplitRoutes['definitions'][number]['children']
    >();
  });

  it('infers schema-less path params, including optional and catch-all fields', () => {
    const raw = defineRoute({
      id: 'raw',
      path: 'raw/:id/:tab?/*rest',
      remountKey: ({ id, tab, rest }) => `${id}:${tab ?? ''}:${rest.join('/')}`,
    });
    expectTypeOf<InferSplitRouteParams<typeof raw>>().toEqualTypeOf<{
      id: string;
      tab?: string;
      rest: string[];
    }>();
    expect(raw.remountKey({ id: 'one', rest: ['a', 'b'] })).toBe('one::a/b');
    expectTypeOf<InferSplitRouteParams<{ id: 'bare' }>>().toEqualTypeOf<
      Record<string, unknown>
    >();
  });

  it('types differently named alias reads separately from canonical destinations', () => {
    const route = defineRoute({
      id: 'alias',
      path: 'item/:id',
      aliases: ['old/:legacyId'],
      serializeParams: (params) => ({
        id: 'id' in params ? params.id : params.legacyId,
      }),
      remountKey: (params) => ('id' in params ? params.id : params.legacyId),
    });
    expectTypeOf<InferSplitRouteParams<typeof route>>().toEqualTypeOf<
      { id: string } | { legacyId: string }
    >();
    expectTypeOf<
      InferSplitRouteNavigationParams<typeof route>
    >().toEqualTypeOf<{ id: string }>();
    const manifest = createRoutesManifest(
      defineRoutes({ definitions: [route] })
    );
    const entry = decodeRoute(manifest, ['old', 'one'])!;
    expect(routeParams(entry.location.route)).toEqual({ legacyId: 'one' });
    expect(encodeRoute(manifest, entry)).toEqual(['item', 'one']);
  });

  it('retains optional ancestor fields and transformed schema outputs', () => {
    const tree = defineRoutes({
      definitions: [
        defineRoute({
          id: 'parent',
          path: 'parent/:workspace?',
          params: z.object({ workspace: z.string().optional() }),
          children: [
            defineRoute({
              id: 'child',
              path: ':page',
              params: z.object({ page: z.coerce.number() }),
            }),
          ],
        }),
      ],
    });
    const child = tree.definitions[0].children[0];
    expectTypeOf<InferSplitRouteBranchParams<typeof child>>().toEqualTypeOf<{
      workspace?: string;
      page: number;
    }>();
    expectTypeOf<
      InferSplitRouteNavigationParams<typeof child>
    >().toEqualTypeOf<{ workspace?: string; page: number }>();
  });

  it('retains required parent values when optional child fields are absent', () => {
    const tree = defineRoutes({
      definitions: [
        defineRoute({
          id: 'parent',
          path: ':id',
          params: z.object({ id: z.string() }),
          children: [
            defineRoute({
              id: 'child',
              path: 'child/:id?',
              params: z.object({ id: z.coerce.number().optional() }),
            }),
          ],
        }),
      ],
    });
    const child = tree.definitions[0].children[0];
    expectTypeOf<InferSplitRouteBranchParams<typeof child>>().toEqualTypeOf<{
      id: string | number | undefined;
    }>();
    const manifest = createRoutesManifest(tree);
    expect(
      routeParams(decodeRoute(manifest, ['parent', 'child'])?.location.route)
    ).toEqual({ id: 'parent' });
    expect(
      routeParams(
        decodeRoute(manifest, ['parent', 'child', '2'])?.location.route
      )
    ).toEqual({ id: 2 });
  });

  it('models shadowed reads but rejects incompatible flat navigation params', () => {
    const tree = defineRoutes({
      definitions: [
        defineRoute({
          id: 'parent',
          path: ':id',
          params: z.object({ id: z.string() }),
          children: [
            defineRoute({
              id: 'child',
              path: ':id',
              params: z.object({ id: z.coerce.number() }),
            }),
          ],
        }),
      ],
    });
    const child = tree.definitions[0].children[0];
    expectTypeOf<InferSplitRouteBranchParams<typeof child>>().toEqualTypeOf<{
      id: number;
    }>();
    expectTypeOf<
      InferSplitRouteNavigationParams<typeof child>
    >().toEqualTypeOf<{ id: never }>();
  });
});

describe('split route operations', () => {
  it('finds a route with its ancestors in manifest order', () => {
    const branch = findRouteBranch(routes, 'drive-folder-detail');
    expect(branch?.map(({ definition }) => definition.id)).toEqual([
      'drive',
      'drive-folder',
      'drive-folder-detail',
    ]);
    expect(branch?.[0]?.definition).toBe(driveRoute);
    expect(findRouteBranch(routes, 'missing')).toBeUndefined();
  });

  it('matches by declaration order rather than path specificity', () => {
    const definitions = [
      defineRoute({ id: 'dynamic', path: ':id' }),
      defineRoute({ id: 'static', path: 'recent' }),
    ];
    expect(
      decodeRoute(createRoutesManifest({ definitions }), ['recent'])?.location
        .route?.matches
    ).toEqual([{ id: 'dynamic', params: { id: 'recent' } }]);
  });

  it('round trips nested feature paths', () => {
    const entry = decodeRoute(routes, [
      'drive',
      'folder',
      'folder-1',
      'pdf',
      'document-1',
    ]);

    expect(entry?.location?.route).toEqual({
      matches: [
        { id: 'drive', params: {} },
        { id: 'drive-folder', params: { folderId: 'folder-1' } },
        {
          id: 'drive-folder-detail',
          params: { documentId: 'document-1' },
        },
      ],
    });
    expect(encodeRoute(routes, entry!)).toEqual([
      'drive',
      'folder',
      'folder-1',
      'pdf',
      'document-1',
    ]);
  });

  it('merges params across a nested match branch', () => {
    const entry = {
      location: {
        route: {
          matches: [
            { id: 'drive', params: {} },
            { id: 'drive-folder', params: { folderId: 'folder-1' } },
            {
              id: 'drive-folder-detail',
              params: { documentId: 'document-1' },
            },
          ] as const,
        },
      },
    };

    expect(routeParams(entry.location.route)).toEqual({
      folderId: 'folder-1',
      documentId: 'document-1',
    });
    expect(encodeRoute(routes, entry)).toEqual([
      'drive',
      'folder',
      'folder-1',
      'pdf',
      'document-1',
    ]);
  });

  it('round trips transformed params with custom serialization', () => {
    const calendarRoute = defineRoute({
      id: 'calendar',
      path: 'calendar/:day',
      params: z.object({ day: z.coerce.date() }),
      serializeParams: ({ day }) => ({ day: day.toISOString().slice(0, 10) }),
    });
    const calendarRoutes = createRoutesManifest({
      definitions: [calendarRoute],
    });
    const entry = decodeRoute(calendarRoutes, ['calendar', '2026-01-02']);

    expect(entry?.location?.route?.matches[0]?.params.day).toEqual(
      new Date('2026-01-02T00:00:00.000Z')
    );
    expect(encodeRoute(calendarRoutes, entry!)).toEqual([
      'calendar',
      '2026-01-02',
    ]);
  });

  it('decodes aliases and encodes their canonical path', () => {
    const entry = decodeRoute(routes, ['files', 'folder', 'folder-1']);

    expect(entry?.location?.route?.matches[0]?.id).toBe('drive');
    expect(encodeRoute(routes, entry!)).toEqual([
      'drive',
      'folder',
      'folder-1',
    ]);
  });

  it('separates URL identity from claimed content identity', () => {
    const direct = decodeRoute(routes, ['drive', 'pdf', 'document-1'])!;
    const nested = decodeRoute(routes, [
      'drive',
      'folder',
      'folder-1',
      'pdf',
      'document-1',
    ])!;

    expect(getRouteClaim(routes, direct.location.route)).toEqual({
      namespace: 'document',
      id: 'document-1',
    });
    expect(getRouteClaim(routes, nested.location.route)).toEqual(
      getRouteClaim(routes, direct.location.route)
    );
  });

  it('returns only query keys owned by the proposed layout', () => {
    const legacy = decodeRoute(routes, ['legacy', 'mail-1'])!;
    const drive = decodeRoute(routes, ['drive'])!;
    const detail = decodeRoute(routes, ['drive', 'pdf', 'document-1'])!;

    expect([...getExternalSearchKeys(routes, [legacy])]).toEqual([
      'referral_code',
    ]);
    expect([...getExternalSearchKeys(routes, [drive])]).toEqual([
      'referral_code',
      'action',
    ]);
    expect([...getExternalSearchKeys(routes, [detail])]).toEqual([
      'referral_code',
      'action',
      'preview',
    ]);
  });

  it('rejects a partial feature route instead of guessing', () => {
    expect(decodeRoute(routes, ['drive', 'folder'])).toBeUndefined();
  });

  it('rejects ambiguous or invalid route manifests', () => {
    expect(() =>
      validateSplitRoutes({
        definitions: [
          { id: 'one', path: 'same' },
          { id: 'two', path: 'other', aliases: ['same'] },
        ],
      })
    ).toThrow('Duplicate sibling split route path "same"');
    expect(() =>
      validateSplitRoutes({
        definitions: [
          {
            id: 'one',
            path: 'one',
            children: [{ id: 'one', path: 'child' }],
          },
        ],
      })
    ).toThrow('Duplicate split route id "one"');
    expect(() =>
      validateSplitRoutes({
        definitions: [{ id: 'one', path: 'one', search: ['not.safe'] }],
      })
    ).toThrow('Invalid split search namespace "not.safe"');
  });
});
