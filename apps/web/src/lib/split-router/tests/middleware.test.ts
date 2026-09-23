import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { prepareEntry, runSplitRouterMiddleware } from '../middleware';
import {
  createRoutesManifest,
  defineRoute,
  rootRouteMatch,
  routeParams,
} from '../routes';
import type { SplitRouterMiddleware } from '../types';

const routes = createRoutesManifest({
  definitions: [
    defineRoute({
      id: 'drive',
      path: 'drive',
      children: [
        {
          id: 'drive-document',
          path: 'md/:documentId',
          params: z.object({ documentId: z.string() }),
        },
      ],
    }),
    {
      id: 'legacy',
      path: 'legacy/:id',
      params: z.object({ id: z.string() }),
    },
  ],
});

const legacyEntry = {
  location: {
    route: {
      matches: [{ id: 'legacy', params: { id: 'document-1' } }] as const,
    },
    search: { view: { mode: ['compact'] } },
  },
};

describe('split router middleware', () => {
  it('stays synchronous when every middleware is synchronous', () => {
    const result = runSplitRouterMiddleware(
      {
        routes,
        handlers: [
          ({ to, redirect }) =>
            rootRouteMatch(to.location.route)?.id === 'legacy'
              ? redirect(`/drive/md/${routeParams(to.location.route).id}`)
              : undefined,
        ],
      },
      {
        to: legacyEntry,
        cause: 'navigate',
        signal: new AbortController().signal,
      }
    );

    expect(result).not.toBeInstanceOf(Promise);
    expect(result).toMatchObject({
      location: {
        route: {
          matches: [
            { id: 'drive', params: {} },
            {
              id: 'drive-document',
              params: { documentId: 'document-1' },
            },
          ],
        },
      },
    });
  });

  it('awaits middleware and restarts the pipeline after a redirect', async () => {
    const visits: string[] = [];
    const searches: (string | undefined)[] = [];
    const middleware: SplitRouterMiddleware[] = [
      async ({ path, externalSearch }) => {
        await Promise.resolve();
        visits.push(`preload:${path}`);
        searches.push(externalSearch);
      },
      ({ to, redirect }) => {
        const routeId = rootRouteMatch(to.location.route)?.id;
        visits.push(`redirect:${routeId}`);
        if (routeId === 'legacy') {
          return redirect(`/drive/md/${routeParams(to.location.route).id}`);
        }
      },
    ];

    const result = await runSplitRouterMiddleware(
      { routes, handlers: middleware },
      {
        to: legacyEntry,
        externalSearch: '?legacy=first&legacy=last',
        cause: 'external',
        signal: new AbortController().signal,
      }
    );

    expect(visits).toEqual([
      'preload:/legacy/document-1',
      'redirect:legacy',
      'preload:/drive/md/document-1',
      'redirect:drive',
    ]);
    expect(searches).toEqual([
      '?legacy=first&legacy=last',
      '?legacy=first&legacy=last',
    ]);
    expect(result).toEqual({
      location: {
        route: {
          matches: [
            { id: 'drive', params: {} },
            {
              id: 'drive-document',
              params: { documentId: 'document-1' },
            },
          ],
        },
        search: { view: { mode: ['compact'] } },
      },
    });
  });

  it('passes cancellation to pending preload work', async () => {
    const controller = new AbortController();
    const observed = vi.fn();
    const pending = runSplitRouterMiddleware(
      {
        routes,
        handlers: [
          ({ signal }) =>
            new Promise<void>((_resolve, reject) => {
              signal.addEventListener('abort', () => {
                observed();
                reject(signal.reason);
              });
            }),
        ],
      },
      {
        to: legacyEntry,
        cause: 'external',
        signal: controller.signal,
      }
    );

    controller.abort(new DOMException('Superseded', 'AbortError'));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(observed).toHaveBeenCalledOnce();
  });

  it('rejects invalid asynchronous results instead of recovering to a malformed proposal', async () => {
    const pending = prepareEntry(
      {
        routes,
        handlers: [
          async ({ to }) => {
            await Promise.resolve();
            to.location.route = { matches: [{ id: 'missing', params: {} }] };
          },
        ],
      },
      {
        to: { location: { route: { matches: [{ id: 'drive', params: {} }] } } },
        cause: 'navigate',
        signal: new AbortController().signal,
      }
    );
    await expect(pending).rejects.toThrow('invalid match branch');
  });

  it('rejects redirect loops', () => {
    expect(() =>
      runSplitRouterMiddleware(
        {
          routes,
          handlers: [({ path, redirect }) => redirect(path)],
        },
        {
          to: legacyEntry,
          cause: 'navigate',
          signal: new AbortController().signal,
        }
      )
    ).toThrow('redirect loop');
  });
});
