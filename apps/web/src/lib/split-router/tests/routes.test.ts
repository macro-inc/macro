import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import {
  createRoutesManifest,
  decodeRoute,
  defineRoute,
  encodeRoute,
  findRouteBranch,
  getExternalSearchKeys,
  getRouteClaim,
  routeParams,
  validateRouteParams,
  validateSplitRoutes,
} from '../routes';
import type { InferSplitRouteParams } from '../types';

const documentClaim = ({ documentId }: { documentId: string }) => ({
  namespace: 'document',
  id: documentId,
});

const driveRoute = defineRoute({
  id: 'drive',
  path: 'drive',
  aliases: ['files'],
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
