import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { prepareEntry, runSplitRouterMiddleware } from '../middleware';
import {
  createRoutesManifest,
  defineRoute,
  rootRouteMatch,
  routeParams,
} from '../routes';
import type { SplitRouterEvent, SplitRouterMiddleware } from '../types';

function event(
  to: SplitRouterEvent['to'],
  options: {
    cause?: SplitRouterEvent['cause'];
    direction?: SplitRouterEvent['direction'];
    signal?: AbortSignal;
    url?: string;
  } = {}
): SplitRouterEvent {
  const signal = options.signal ?? new AbortController().signal;
  return {
    request: new Request(options.url ?? 'https://macro.test/', { signal }),
    splitId: undefined,
    from: undefined,
    to,
    path: '',
    cause: options.cause ?? 'navigate',
    direction: options.direction ?? 'push',
  };
}

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
      event(legacyEntry)
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
      async ({ path, request }) => {
        await Promise.resolve();
        visits.push(`preload:${path}`);
        searches.push(new URL(request.url).search || undefined);
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
      event(legacyEntry, {
        cause: 'external',
        direction: 'replace',
        url: 'https://macro.test/legacy/document-1?legacy=first&legacy=last',
      })
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
          ({ request }) =>
            new Promise<void>((_resolve, reject) => {
              request.signal.addEventListener('abort', () => {
                observed();
                reject(request.signal.reason);
              });
            }),
        ],
      },
      event(legacyEntry, {
        cause: 'external',
        direction: 'replace',
        signal: controller.signal,
      })
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
      event({ location: { route: { matches: [{ id: 'drive', params: {} }] } } })
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
        event(legacyEntry)
      )
    ).toThrow('redirect loop');
  });
});
