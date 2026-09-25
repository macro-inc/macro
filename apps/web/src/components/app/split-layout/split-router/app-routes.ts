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
import { homeRoute } from '@app/features/home/route';
import { inboxSplitRoute } from '@app/features/inbox-view/route';
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
import { defineRoutes } from '@app/lib/split-router';
import { debugRoutes } from './debug-routes';
import { handleLegacySplitPath, legacySplitRoute } from './legacy-route';

export const appSplitRoutes = defineRoutes({
  definitions: [
    driveSplitRoute,
    settingsRoute,
    agentsRoute,
    codersRoute,
    agentChatsRoute,
    homeRoute,
    gettingStartedRoute,
    inboxSplitRoute,
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
  unmatchedPathHandlers: [handleLegacySplitPath],
  defaultEntry: () => ({
    location: { route: { matches: [{ id: 'view-inbox', params: {} }] } },
  }),
});
