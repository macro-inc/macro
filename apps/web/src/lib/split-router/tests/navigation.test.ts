import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { resolveNavigation } from '../navigation';
import {
  createRoutesManifest,
  decodeRoute,
  defineRoute,
  routeParams,
} from '../routes';
import type { SplitNavigate, SplitRouterEntry } from '../types';

const workspaceDetailRoute = defineRoute({
  id: 'workspace-detail',
  path: 'detail/:documentId',
  params: z.object({ documentId: z.string() }),
});

const workspacePageRoute = defineRoute({
  id: 'workspace-page',
  path: 'page/:page',
  params: z.object({ page: z.coerce.number().int().positive() }),
});

const workspaceFolderRoute = defineRoute({
  id: 'workspace-folder',
  path: 'folder/:folderId',
  params: z.object({ folderId: z.string() }),
  children: [workspaceDetailRoute],
});

const workspaceRoute = defineRoute({
  id: 'workspace',
  path: 'workspace',
  search: ['workspace'],
  children: [workspaceFolderRoute, workspacePageRoute],
});

const routes = createRoutesManifest({
  definitions: [workspaceRoute],
});

function entry(path: string[]): SplitRouterEntry {
  return decodeRoute(routes, path)!;
}

function assertTypedRouteTargets(navigate: SplitNavigate<string>) {
  navigate({
    route: workspaceDetailRoute,
    params: { documentId: 'document-1' },
  });
  navigate({ route: workspaceRoute });
  navigate({ route: workspacePageRoute, params: { page: 2 } });
  // @ts-expect-error navigation uses the schema output type
  navigate({ route: workspacePageRoute, params: { page: '2' } });
  // @ts-expect-error documentId is required by the route schema
  navigate({ route: workspaceDetailRoute });
  // @ts-expect-error documentId must be a string
  navigate({
    route: workspaceDetailRoute,
    params: { documentId: 1 },
  });
}

describe('split route navigation', () => {
  it('requires params inferred from typed route schemas', () => {
    expectTypeOf(assertTypedRouteTargets).toBeFunction();
  });

  it('round trips typed navigation params through route schemas', () => {
    const current = entry(['workspace']);
    const next = resolveNavigation(routes, current, current, {
      route: workspacePageRoute,
      params: { page: 2 },
    });

    expect(next?.location?.route?.matches).toEqual([
      { id: 'workspace', params: {} },
      { id: 'workspace-page', params: { page: 2 } },
    ]);
  });

  it('appends explicit child-relative paths to the current route', () => {
    const current = entry(['workspace', 'folder', 'folder-1']);
    const next = resolveNavigation(
      routes,
      current,
      current,
      './detail/document-1'
    );

    expect(next?.location?.route?.matches).toEqual([
      { id: 'workspace', params: {} },
      { id: 'workspace-folder', params: { folderId: 'folder-1' } },
      { id: 'workspace-detail', params: { documentId: 'document-1' } },
    ]);
  });

  it('navigates to a parent while preserving its params and search', () => {
    const current = entry([
      'workspace',
      'folder',
      'folder-1',
      'detail',
      'document-1',
    ]);
    current.location = {
      ...current.location,
      search: { workspace: { sort: ['name'] } },
    };
    const next = resolveNavigation(routes, current, current, { parent: true });

    expect(next?.location).toEqual({
      route: {
        matches: [
          { id: 'workspace', params: {} },
          { id: 'workspace-folder', params: { folderId: 'folder-1' } },
        ],
      },
      search: { workspace: { sort: ['name'] } },
    });
  });

  it('navigates by a typed route and preserves matching ancestor params', () => {
    const current = entry(['workspace', 'folder', 'folder-1']);
    const next = resolveNavigation(routes, current, current, {
      route: workspaceDetailRoute,
      params: { documentId: 'document-2' },
    });

    expect(next?.location?.route?.matches).toEqual([
      { id: 'workspace', params: {} },
      { id: 'workspace-folder', params: { folderId: 'folder-1' } },
      { id: 'workspace-detail', params: { documentId: 'document-2' } },
    ]);
    expect(routeParams(next?.location?.route)).toEqual({
      folderId: 'folder-1',
      documentId: 'document-2',
    });
  });

  it('returns undefined for invalid parent and route destinations', () => {
    const current = entry(['workspace']);

    expect(
      resolveNavigation(routes, current, current, { parent: true })
    ).toBeUndefined();
    expect(
      resolveNavigation(routes, current, current, {
        route: { id: 'missing' },
      })
    ).toBeUndefined();
  });
});
