import { describe, expect, it } from 'vitest';
import {
  decodePanes,
  encodePanes,
  formatPanePath,
  splitPanePaths,
} from '../routes/codec';
import { defineRoute } from '../routes/define';
import {
  canonicalRoute,
  createRoutesManifest,
  decodePane,
  formatPane,
} from '../routes/manifest';
import { compileRoutePattern } from '../routes/path';
import { claimOf, externalSearchKeys, ownsNamespace } from '../routes/queries';
import { resolveTarget } from '../routes/targets';
import type { PaneId, SplitLocation, SplitRouteState } from '../routes/types';
import {
  appRoutes,
  documentRoute,
  driveRoute,
  folderRoute,
  mailRoute,
  notFoundRoute,
} from './fixtures';

const routes = createRoutesManifest(appRoutes);
const matchIds = (route: SplitRouteState | undefined) =>
  route?.matches.map((match) => match.id);
/** The pane route ids below the app route. */
const ids = (route: SplitRouteState | undefined) =>
  matchIds(route)?.filter((id) => id !== 'app');
const decodeUrl = (path: string, search = '') =>
  decodePanes(routes, { path, search, hash: '' }).panes.map((pane) =>
    matchIds(pane.entry.location.route)
  );
const at = (path: string): SplitLocation => ({
  route: decodePane(routes, path.split('/').filter(Boolean))!,
});

describe('route matching', () => {
  it('prefers specific routes regardless of declaration order', () => {
    expect(ids(decodePane(routes, ['mail', 't1']))).toEqual([
      'mail',
      'mail-thread',
    ]);
    expect(ids(decodePane(routes, ['md', 'doc']))).toEqual(['block']);
    expect(ids(decodePane(routes, ['drive', 'md', 'doc']))).toEqual([
      'drive',
      'drive-document',
    ]);
    expect(ids(decodePane(routes, ['drive', 'folder']))).toEqual([
      'drive',
      'drive-folder',
    ]);
    expect(decodePane(routes, ['drive', 'folder', 'f1'])?.matches[2]).toEqual({
      id: 'drive-folder',
      params: { folderId: 'f1' },
    });
  });

  it('moves to the next branch when a params schema rejects the match', () => {
    expect(ids(decodePane(routes, ['drive', 'garbage']))).toEqual([
      'not-found',
    ]);
    expect(ids(decodePane(routes, ['video', 'x']))).toEqual(['not-found']);
  });

  it('matches static segments case-insensitively and formats the declared casing', () => {
    const route = decodePane(routes, ['DRIVE', 'Folder']);
    expect(ids(route)).toEqual(['drive', 'drive-folder']);
    expect(formatPane(routes, route!)).toEqual(['drive', 'folder']);
  });

  it('ranks a nested catch-all above the root catch-all', () => {
    const driveMissing = defineRoute({ id: 'drive-missing', path: '*rest' });
    const nested = createRoutesManifest({
      ...appRoutes,
      definitions: [
        notFoundRoute,
        { ...driveRoute, children: [folderRoute, documentRoute, driveMissing] },
      ],
    });
    expect(ids(decodePane(nested, ['drive', 'garbage']))).toEqual([
      'drive',
      'drive-missing',
    ]);
    expect(ids(decodePane(nested, ['elsewhere']))).toEqual(['not-found']);
  });

  it('matches a route without a path only through its children', () => {
    expect(matchIds(decodePane(routes, ['home']))).toEqual(['app', 'home']);
    expect(decodePane(routes, [])).toBeUndefined();
    expect(formatPane(routes, decodePane(routes, ['mail', 't1'])!)).toEqual([
      'mail',
      't1',
    ]);
  });

  it('matches an empty pane with an empty path', () => {
    const withBase = createRoutesManifest({
      ...appRoutes,
      definitions: [
        defineRoute({ id: 'base', path: '' }),
        ...appRoutes.definitions,
      ],
    });
    expect(matchIds(decodePane(withBase, []))).toEqual(['base']);
    expect(formatPanePath(withBase, decodePane(withBase, [])!)).toBe('/');
  });

  it('expands adjacent optional params into prefixes only', () => {
    const pattern = compileRoutePattern({ path: 'a/:b?/:c?' });
    expect(pattern.alternatives.map((tokens) => tokens.length)).toEqual([
      1, 2, 3,
    ]);
  });

  it('rejects invalid declarations', () => {
    const home = defineRoute({ id: 'home', path: 'home' });
    expect(() =>
      createRoutesManifest({ ...appRoutes, definitions: [home, home] })
    ).toThrow(/Duplicate split route id/);
    expect(() =>
      createRoutesManifest({
        ...appRoutes,
        definitions: [home, defineRoute({ id: 'other', path: '/home/' })],
      })
    ).toThrow(/Duplicate sibling split route path/);
    expect(() =>
      createRoutesManifest({
        ...appRoutes,
        definitions: [defineRoute({ id: 'bad', path: '*rest/after' })],
      })
    ).toThrow(/catch-all/);
    expect(() =>
      createRoutesManifest({ ...appRoutes, definitions: [{ id: 'empty' }] })
    ).toThrow(/has no path, so it needs children/);
    expect(() =>
      createRoutesManifest({
        ...appRoutes,
        definitions: [
          home,
          defineRoute({
            id: 'layout',
            children: [defineRoute({ id: 'nested-home', path: 'home' })],
          }),
        ],
      })
    ).toThrow(/Duplicate sibling split route path/);
  });
});

describe('route queries', () => {
  it('uses the deepest claim and falls back to ancestors', () => {
    expect(claimOf(routes, at('/drive/md/d1').route)).toBe('block:md:d1');
    expect(claimOf(routes, at('/mail/t1').route)).toBe('block:email:t1');
    expect(claimOf(routes, at('/mail').route)).toBeUndefined();
  });

  it('restricts search only where a route lists namespaces', () => {
    const drive = at('/drive/folder/f1').route;
    expect(ownsNamespace(routes, drive, 'drive')).toBe(true);
    expect(ownsNamespace(routes, drive, 'mail')).toBe(false);
    expect(ownsNamespace(routes, at('/mail/t1').route, 'anything')).toBe(true);
  });

  it('keeps global and route-owned unprefixed search keys', () => {
    const withExternal = createRoutesManifest({
      ...appRoutes,
      definitions: [
        ...appRoutes.definitions,
        defineRoute({ id: 'pdf', path: 'viewer', externalSearch: ['page'] }),
      ],
    });
    const keys = externalSearchKeys(withExternal, [
      { id: 'e', location: { route: decodePane(withExternal, ['viewer'])! } },
    ]);
    expect([...keys].sort()).toEqual(['page', 'referral_code']);
  });
});

describe('panes codec', () => {
  it('decodes each pane on its own, so an unmatched app pane is not found', () => {
    const decoded = decodePanes(routes, {
      path: '/mail/t1/~/no/such/place/~/drive',
      search: '',
      hash: '',
    });
    expect(decoded.panes.map((pane) => ids(pane.entry.location.route))).toEqual(
      [['mail', 'mail-thread'], ['not-found'], ['drive']]
    );
    expect(decoded.panes[1]!.entry.location.route.matches[1]!.params).toEqual({
      segments: ['no', 'such', 'place'],
    });
  });

  it('redirects a URL no top-level route handles to the default route', () => {
    const home = [['app', 'home']];
    expect(decodeUrl('/no/such/place')).toEqual(home);
    expect(decodeUrl('/')).toEqual(home);
    expect(decodeUrl('/login/~/home')).toEqual(home);
    expect(decodeUrl('/mail/~/login')).toEqual(home);
    expect(decodeUrl('/login')).toEqual([['login']]);
  });

  it('shows a top-level catch-all as the 404 page', () => {
    const withPage = createRoutesManifest({
      ...appRoutes,
      definitions: [
        ...appRoutes.definitions,
        defineRoute({ id: 'page-not-found', path: '*path' }),
      ],
    });
    const decode = (path: string) =>
      decodePanes(withPage, { path, search: '', hash: '' }).panes.map((pane) =>
        matchIds(pane.entry.location.route)
      );
    expect(decode('/no/such/place')).toEqual([['page-not-found']]);
    expect(decode('/home')).toEqual([['app', 'home']]);
    expect(decode('/no/such/place/~/home')).toEqual([['app', 'home']]);
  });

  it('reads pane and entry ids back only when the pane count matches', () => {
    const state = {
      panes: [
        { pane: 'p1' as PaneId, entry: 'e1' },
        { pane: 'p2' as PaneId, entry: 'e2' },
      ],
    };
    const matching = decodePanes(routes, {
      path: '/home/~/mail',
      search: '',
      hash: '',
      state,
    });
    expect(matching.panes.map((pane) => [pane.paneId, pane.entry.id])).toEqual([
      ['p1', 'e1'],
      ['p2', 'e2'],
    ]);
    const mismatched = decodePanes(routes, {
      path: '/home',
      search: '',
      hash: '',
      state,
    });
    expect(mismatched.panes[0]!.paneId).toBeUndefined();
  });

  it('frames search by pane and drops namespaces a route does not own', () => {
    const decoded = decodePanes(routes, {
      path: '/drive/~/mail',
      search: '?s0.drive.sort=name&s0.other.x=1&s1.mail.tab=inbox',
      hash: '',
    });
    expect(decoded.panes.map((pane) => pane.entry.location.search)).toEqual([
      { drive: { sort: ['name'] } },
      { mail: { tab: ['inbox'] } },
    ]);
  });

  it('encodes panes, keeps owned unprefixed keys, and keeps the hash while the path is unchanged', () => {
    const entry = {
      id: 'e1',
      location: {
        ...at('/drive/folder/f1'),
        search: { drive: { sort: ['name'] } },
      },
    };
    const mail = { id: 'e2', location: at('/mail/t1') };
    const encoded = encodePanes(
      routes,
      [
        { paneId: 'p1' as PaneId, entry },
        { paneId: 'p2' as PaneId, entry: mail },
      ],
      {
        path: '/drive/folder/f1/~/mail/t1',
        search: '?referral_code=r&junk=1',
        hash: '#h',
      }
    );
    expect(encoded).toEqual({
      path: '/drive/folder/f1/~/mail/t1',
      search: '?referral_code=r&s0.drive.sort=name',
      hash: '#h',
      state: {
        panes: [
          { pane: 'p1', entry: 'e1' },
          { pane: 'p2', entry: 'e2' },
        ],
      },
    });
    expect(
      encodePanes(routes, [{ paneId: 'p2' as PaneId, entry: mail }], encoded)
        .hash
    ).toBe('');
  });

  it('keeps every unprefixed key while a route with externalSearch "*" shows', () => {
    const login = { id: 'e1', location: at('/login') };
    const encoded = encodePanes(
      routes,
      [{ paneId: 'p1' as PaneId, entry: login }],
      { path: '/home', search: '?email=a&next=b&s0.drive.sort=name', hash: '' }
    );
    expect(encoded.search).toBe('?email=a&next=b');
  });

  it('escapes a literal separator value so it round-trips', () => {
    const route = canonicalRoute(routes, {
      matches: [
        { id: 'app', params: {} },
        { id: 'block', params: { type: 'md', id: '~' } },
      ],
    })!;
    const path = formatPanePath(routes, route);
    expect(path).toBe('/md/%7E');
    expect(splitPanePaths(path)).toEqual([['md', '%7E']]);
    expect(
      decodePanes(routes, { path, search: '', hash: '' }).panes[0]!.entry
        .location.route.matches[1]!.params
    ).toEqual({ type: 'md', id: '~' });
  });
});

describe('target resolution', () => {
  const folder: SplitLocation = {
    ...at('/drive/folder/f1'),
    search: { drive: { sort: ['name'] } },
  };

  it('resolves relative paths against the calling route', () => {
    expect(
      ids(resolveTarget(routes, folder, 'md/d1', { depth: 2 })?.route)
    ).toEqual(['drive', 'drive-document']);
    expect(
      resolveTarget(routes, folder, '../f2', { depth: 3 })?.route.matches[2]
    ).toEqual({ id: 'drive-folder', params: { folderId: 'f2' } });
    expect(ids(resolveTarget(routes, folder, '/mail/t2')?.route)).toEqual([
      'mail',
      'mail-thread',
    ]);
  });

  it('inherits ancestor params and carries search only within the same root', () => {
    const document = resolveTarget(routes, folder, {
      route: documentRoute,
      params: { documentType: 'md', documentId: 'd1' },
    });
    expect(ids(document?.route)).toEqual(['drive', 'drive-document']);
    expect(document?.search).toEqual({ drive: { sort: ['name'] } });
    expect(
      resolveTarget(routes, folder, { route: mailRoute })?.search
    ).toBeUndefined();
  });

  it('applies search updates and drops namespaces the destination does not own', () => {
    const location = resolveTarget(routes, folder, '/drive', {
      search: { drive: { view: ['grid'] }, mail: { tab: ['x'] } },
    });
    expect(location?.search).toEqual({ drive: { view: ['grid'] } });
  });
});
