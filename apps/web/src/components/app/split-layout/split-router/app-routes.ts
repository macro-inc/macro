import { activityRoute } from '@app/features/activity/route';
import { DIFF_SEARCH_PARAM } from '@app/features/agent-changes/core/url-state';
import {
  agentChatsRoute,
  agentsRoute,
  agentsViewRoute,
  codersRoute,
} from '@app/features/agents-view/route';
import { callDetailRoute } from '@app/features/block-call/route';
import { prDetailRoute } from '@app/features/block-pr/route';
import { calendarSplitRoute } from '@app/features/calendar-view/route';
import { channelsSplitRoute } from '@app/features/channels-view/route';
import { companiesRoute } from '@app/features/companies/route';
import { driveSplitRoute } from '@app/features/drive-view/route';
import { emailSplitRoute } from '@app/features/email-view/route';
import { gettingStartedRoute } from '@app/features/getting-started/route';
import { homeSplitRoute } from '@app/features/home/route';
import {
  callsRoute,
  foldersRoute,
  recentRoute,
  searchRoute,
} from '@app/features/next-soup/route';
import { remindersRoute } from '@app/features/reminders/route';
import { reviewsSplitRoute } from '@app/features/reviews-view/route';
import { settingsRoute } from '@app/features/settings/route';
import { tasksSplitRoute } from '@app/features/tasks-view/route';
import {
  createRoutesManifest,
  decodeRouteLayout,
  defineRoutes,
  SPLIT_PATH_SEPARATOR,
  type SplitRoutesManifest,
  type UnmatchedSplitPathHandler,
} from '@app/lib/split-router';
import { debugRoutes } from './debug-routes';
import { handleLegacySplitPath, legacySplitRoute } from './legacy-route';

const RETIRED_HOME_PATH = 'inbox';

let retiredPathManifest: SplitRoutesManifest | undefined;

/**
 * Home lived at `/inbox` before it moved to `/home`. Bookmarks, notification
 * deep links, and restored layouts still carry the old segment, so decode
 * them as if they had been written with the new one, frame by frame.
 */
const handleRetiredHomePath: UnmatchedSplitPathHandler = ({ segments }) => {
  const rewritten = segments.map((segment, index) =>
    segment === RETIRED_HOME_PATH &&
    (index === 0 || segments[index - 1] === SPLIT_PATH_SEPARATOR)
      ? 'home'
      : segment
  );
  if (rewritten.every((segment, index) => segment === segments[index])) return;
  // Without a default entry an undecodable path yields [] and defers to the
  // remaining handlers instead of silently landing on Home.
  retiredPathManifest ??= createRoutesManifest({
    ...appSplitRoutes,
    unmatchedPathHandlers: [handleLegacySplitPath],
    defaultEntry: undefined,
  });
  const entries = decodeRouteLayout(retiredPathManifest, rewritten);
  return entries.length > 0 ? entries : undefined;
};

export const appSplitRoutes = defineRoutes({
  definitions: [
    driveSplitRoute,
    settingsRoute,
    agentsRoute,
    codersRoute,
    agentChatsRoute,
    homeSplitRoute,
    gettingStartedRoute,
    recentRoute,
    activityRoute,
    remindersRoute,
    agentsViewRoute,
    emailSplitRoute,
    tasksSplitRoute,
    reviewsSplitRoute,
    calendarSplitRoute,
    channelsSplitRoute,
    callsRoute,
    callDetailRoute,
    companiesRoute,
    foldersRoute,
    searchRoute,
    prDetailRoute,
    ...debugRoutes,
    legacySplitRoute,
  ],
  // The changes viewer keys its entries by host, not by pane, so its key is
  // owned globally; a route-local one would be dropped on the next commit.
  globalSearch: ['referral_code', DIFF_SEARCH_PARAM],
  unmatchedPathHandlers: [handleRetiredHomePath, handleLegacySplitPath],
  defaultEntry: () => ({
    location: { route: { matches: [{ id: 'view-home', params: {} }] } },
  }),
});
