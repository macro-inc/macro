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
const ids = (route: SplitRouteState | undefined) =>
  route?.matches.map((match) => match.id);
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
    expect(decodePane(routes, ['drive', 'folder', 'f1'])?.matches[1]).toEqual({
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
  it('decodes each pane on its own, so one unmatched pane is not found', () => {
    const decoded = decodePanes(routes, {
      path: '/mail/t1/~/no/such/place/~/drive',
      search: '',
      hash: '',
    });
    expect(decoded.panes.map((pane) => ids(pane.entry.location.route))).toEqual(
      [['mail', 'mail-thread'], ['not-found'], ['drive']]
    );
    expect(decoded.panes[1]!.entry.location.route.matches[0].params).toEqual({
      segments: ['no', 'such', 'place'],
    });
  });

  it('falls back to the default route for a pane only when nothing matches', () => {
    const strict = createRoutesManifest({
      ...appRoutes,
      definitions: [mailRoute, defineRoute({ id: 'home', path: 'home' })],
    });
    const decoded = decodePanes(strict, {
      path: '/mail/t1/~/unknown',
      search: '',
      hash: '',
    });
    expect(decoded.panes.map((pane) => ids(pane.entry.location.route))).toEqual(
      [['mail', 'mail-thread'], ['home']]
    );
    expect(
      ids(
        decodePanes(strict, { path: '/', search: '', hash: '' }).panes[0]!.entry
          .location.route
      )
    ).toEqual(['home']);
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

  it('escapes a literal separator value so it round-trips', () => {
    const route = canonicalRoute(routes, {
      matches: [{ id: 'block', params: { type: 'md', id: '~' } }],
    })!;
    const path = formatPanePath(routes, route);
    expect(path).toBe('/md/%7E');
    expect(splitPanePaths(path)).toEqual([['md', '%7E']]);
    expect(
      decodePanes(routes, { path, search: '', hash: '' }).panes[0]!.entry
        .location.route.matches[0].params
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
      ids(resolveTarget(routes, folder, 'md/d1', { depth: 1 })?.route)
    ).toEqual(['drive', 'drive-document']);
    expect(
      resolveTarget(routes, folder, '../f2', { depth: 2 })?.route.matches[1]
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
