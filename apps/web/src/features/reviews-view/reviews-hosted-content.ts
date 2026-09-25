import type { SplitLocation, SplitRouteMatch } from '@app/lib/split-router';
import type { SplitContent } from '@components/app/split-layout/layoutManager';

const hostedDetailRoutes = {
  pr: (id: string): SplitRouteMatch => ({
    id: 'reviews-pr',
    params: { foreignEntityId: id },
  }),
} satisfies Record<string, (id: string) => SplitRouteMatch>;

/** Open a Reviews-hosted detail without mounting its legacy block. */
export function reviewsHostedContent(
  content: { type: string; id: string },
  search?: SplitLocation['search']
): SplitContent | undefined {
  const detail = hostedDetailRoutes[
    content.type as keyof typeof hostedDetailRoutes
  ]?.(content.id);
  if (!detail) return;

  return {
    type: 'component',
    id: 'reviews',
    entryMetadata: {
      route: { matches: [{ id: 'view-reviews', params: {} }, detail] },
      ...(search ? { search } : {}),
    },
  };
}
