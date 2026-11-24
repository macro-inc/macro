import { createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';

const soup = vi.hoisted(() => ({ options: [] as unknown[] }));
vi.mock('@queries/soup/items', () => ({
  QUICK_ACCESS_FEED_OPTIONS: { ignoresNotifications: true },
  useSoupAstItemsQuery: (_args: unknown, options?: () => unknown) => {
    soup.options.push(options?.());
    return { isPending: true };
  },
}));

const { useFigLibrarySource } = await import('./fig-libraries');

it('lists library designs without notifications, which it never shows', () => {
  createRoot((dispose) => {
    useFigLibrarySource('doc-1');
    dispose();
  });
  expect(soup.options).toEqual([
    { ignoresNotifications: true, staleTime: 60_000 },
  ]);
});
