import { activityRoute } from '@app/features/activity/route';
import {
  agentChatsRoute,
  agentsRoute,
  agentsViewRoute,
  codersRoute,
} from '@app/features/agents-view/route';
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
import { settingsRoute } from '@app/features/settings/route';
import { tasksSplitRoute } from '@app/features/tasks-view/route';
import { defineRoutes } from '@app/lib/split-router';
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
    calendarSplitRoute,
    channelsSplitRoute,
    callsRoute,
    companiesRoute,
    foldersRoute,
    searchRoute,
    legacySplitRoute,
  ],
  globalSearch: ['referral_code'],
  unmatchedPathHandlers: [handleLegacySplitPath],
  defaultEntry: () => ({
    location: { route: { matches: [{ id: 'view-inbox', params: {} }] } },
  }),
});
