import {
  defineRoute,
  type SplitLocation,
  type SplitRoutesManifest,
} from '@app/lib/split-router';
import { paneRootMatch, paneRoute } from '@app/routes/app-route';
import type { SplitContent } from '@components/app/split-layout/layoutManager';
import { z } from 'zod';

// Keep the production Tasks route IDs and wildcard search contract, without
// loading unrelated app routes and document renderers into this fixture.
export const appRoute = defineRoute({ id: 'app' });
export const homeSplitRoute = defineRoute({
  id: 'view-home',
  path: 'home',
  search: '*' as const,
});
export const tasksSplitRoute = defineRoute({
  id: 'view-tasks',
  path: 'tasks',
  search: '*' as const,
});
export const tasksProjectsRoute = defineRoute({
  id: 'tasks-projects',
  path: 'projects',
});
export const taskDetailRoute = defineRoute({
  id: 'tasks-task',
  path: ':taskId',
  params: z.object({ taskId: z.string() }),
});
export function splitContentFromLocation(
  location: SplitLocation
): SplitContent {
  return {
    type: 'component',
    id: paneRootMatch(location.route)?.id === 'view-tasks' ? 'tasks' : 'home',
  };
}
export function resolveContentLocation(
  _routes: SplitRoutesManifest,
  content: SplitContent
): SplitLocation {
  const metadata = content.entryMetadata;
  const parsed = z
    .record(z.string(), z.record(z.string(), z.array(z.string())))
    .optional()
    .safeParse(
      metadata && typeof metadata === 'object' && 'search' in metadata
        ? metadata.search
        : undefined
    );
  return {
    route: paneRoute({
      id: content.id === 'tasks' ? 'view-tasks' : 'view-home',
      params: {},
    }),
    search: parsed.success ? parsed.data : undefined,
  };
}
