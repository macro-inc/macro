import { activityRoute } from '@app/features/activity/route';
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
import { companiesRoute } from '@app/features/crm/route';
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
import {
  reminderDetailRoute,
  remindersRoute,
} from '@app/features/reminders/route';
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
    homeSplitRoute,
    gettingStartedRoute,
    recentRoute,
    activityRoute,
    reminderDetailRoute,
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
  globalSearch: ['referral_code'],
  unmatchedPathHandlers: [handleLegacySplitPath],
  defaultEntry: () => ({
    location: { route: { matches: [{ id: 'view-home', params: {} }] } },
  }),
});
