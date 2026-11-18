import { expect, it, vi } from 'vitest';
import { preloadLocation } from '../router/preload';
import { createRoutesManifest } from '../routes/manifest';
import type { SplitLocation } from '../routes/types';

it('provides the leaf entity to shared ancestors while code and data start independently', async () => {
  const data = vi.fn();
  const code = vi.fn(() => new Promise<void>(() => {}));
  const routes = createRoutesManifest({
    definitions: [
      {
        id: 'app',
        path: '',
        preload: data,
        children: [
          {
            id: 'mail',
            path: 'mail',
            children: [
              {
                id: 'thread',
                path: ':id',
                component: Object.assign(() => null, { preload: code }),
                toReference: ({ id }) => ({ type: 'email', id: String(id) }),
              },
            ],
          },
        ],
      },
    ],
    defaultRoute: () => ({ matches: [{ id: 'app', params: {} }] }),
  });
  const location: SplitLocation = {
    route: {
      matches: [
        { id: 'app', params: {} },
        { id: 'mail', params: {} },
        { id: 'thread', params: { id: 'thread-id' } },
      ],
    },
  };
  await preloadLocation(routes, {
    location,
    intent: 'hover',
    signal: new AbortController().signal,
  });
  expect(code).toHaveBeenCalledOnce();
  expect(data).toHaveBeenCalledWith(
    expect.objectContaining({
      reference: { type: 'email', id: 'thread-id' },
      location,
    })
  );
});
