import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createRoutesManifest, decodeRoute, routeParams } from '../routes';
import type { SplitRouterEntry, SplitRoutes } from '../types';
import {
  decodeRouteLayout,
  decodeSplitRouterLocation,
  encodeRouteLayout,
  formatRoutePathname,
  parseRoutePathname,
  serializeSplitRouterLocation,
} from '../url';

const routeDefinitions: SplitRoutes = {
  definitions: [
    {
      id: 'drive',
      path: 'drive',
      search: ['drive'],
      children: [{ id: 'folder', path: 'folder/:folderId' }],
    },
    { id: 'legacy', path: 'legacy/:id' },
  ],
  globalSearch: ['referral_code'],
};
const routes = createRoutesManifest(routeDefinitions);

describe('split layout URLs', () => {
  it('frames feature routes alongside legacy splits', () => {
    const drive = decodeRoute(routes, ['drive'])!;
    expect(
      encodeRouteLayout(routes, [
        decodeRoute(routes, ['legacy', 'mail-1'])!,
        drive,
      ])
    ).toEqual(['legacy', 'mail-1', '~', 'drive']);
  });

  it('runs unmatched path handlers until one handles the URL', () => {
    const legacyRoutes = createRoutesManifest({
      ...routeDefinitions,
      unmatchedPathHandlers: [
        () => undefined,
        ({ segments }) => {
          if (segments.length < 2 || segments.length % 2 !== 0) return;
          const entries: SplitRouterEntry[] = [];
          for (let index = 0; index < segments.length; index += 2) {
            if (segments[index] !== 'legacy') return;
            entries.push(
              decodeRoute(routes, segments.slice(index, index + 2))!
            );
          }
          return entries;
        },
      ],
    });
    const entries = decodeRouteLayout(legacyRoutes, [
      'legacy',
      'mail-1',
      'legacy',
      'mail-2',
    ]);

    expect(
      entries.map((entry) => routeParams(entry.location.route).id)
    ).toEqual(['mail-1', 'mail-2']);
    expect(encodeRouteLayout(legacyRoutes, entries)).toEqual([
      'legacy',
      'mail-1',
      '~',
      'legacy',
      'mail-2',
    ]);
  });

  it('reports the partial root match to recovery before falling back', () => {
    const recover = vi.fn(() => undefined);
    const fallback = decodeRoute(routes, ['drive'])!;
    const defaultEntry = vi.fn(() => fallback);
    const recoveryRoutes = createRoutesManifest({
      definitions: [
        {
          id: 'settings',
          path: 'settings/:tab',
          params: z.object({ tab: z.literal('account') }),
        },
        ...routeDefinitions.definitions,
      ],
      unmatchedPathHandlers: [recover],
      defaultEntry,
    });

    expect(decodeRouteLayout(recoveryRoutes, ['settings', 'invalid'])).toEqual([
      fallback,
    ]);
    expect(recover).toHaveBeenCalledWith({
      segments: ['settings', 'invalid'],
      matchedRouteId: 'settings',
    });
    expect(defaultEntry).toHaveBeenCalledOnce();
  });

  it('rejects unresolved default and recovered entries before returning a layout', () => {
    const unresolved = { location: {} } as SplitRouterEntry;
    const invalidBranch: SplitRouterEntry = {
      location: {
        route: { matches: [{ id: 'folder', params: { folderId: 'one' } }] },
      },
    };
    for (const entry of [unresolved, invalidBranch]) {
      const fallbackRoutes = createRoutesManifest({
        ...routeDefinitions,
        defaultEntry: () => entry,
      });
      expect(() => decodeRouteLayout(fallbackRoutes, ['unmatched'])).toThrow(
        'Split route state'
      );
      const recoveryRoutes = createRoutesManifest({
        ...routeDefinitions,
        unmatchedPathHandlers: [() => [entry]],
      });
      expect(() => decodeRouteLayout(recoveryRoutes, ['unmatched'])).toThrow(
        'Split route state'
      );
    }
    expect(decodeRouteLayout(routes, ['unmatched'])).toEqual([]);
  });

  it('keeps framed duplicate routes in visible order', () => {
    const parts = ['drive', '~', 'drive'];
    const entries = decodeRouteLayout(routes, parts);
    expect(entries).toHaveLength(2);
    expect(encodeRouteLayout(routes, entries)).toEqual(parts);
  });

  it('round trips encoded segments with a base path', () => {
    const basedRoutes = createRoutesManifest({
      ...routeDefinitions,
      basePath: '/app',
    });
    const segments = ['drive', 'folder', 'a/b c'];
    const pathname = formatRoutePathname(basedRoutes, segments);
    expect(pathname).toBe('/app/drive/folder/a%2Fb%20c');
    expect(parseRoutePathname(basedRoutes, pathname)).toEqual(segments);
    expect(
      parseRoutePathname(basedRoutes, '/app/drive/%E0%A4%A')
    ).toBeUndefined();
  });

  it('preserves owned query values and hashes without keeping unrelated search', () => {
    const previous =
      '/drive/folder/one?s0.drive.tags=b&s0.drive.tags=a&s0.other.x=1&referral_code=ref&unowned=1#heading';
    const parsed = decodeSplitRouterLocation({ routes, location: previous });
    expect(parsed.entries[0]?.location.search).toEqual({
      drive: { tags: ['b', 'a'] },
    });
    expect(
      serializeSplitRouterLocation({
        routes,
        entries: parsed.entries,
        previous,
      })
    ).toBe(
      '/drive/folder/one?referral_code=ref&s0.drive.tags=b&s0.drive.tags=a#heading'
    );
  });
});
