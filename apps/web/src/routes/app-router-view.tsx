import { ROUTER_BASE } from '@app/constants/routerBase';
import { ActivityRouteView } from '@app/features/activity/route-views';
import { AgentsRouteView } from '@app/features/agents-view/route-views';
import { CallDetailRouteView } from '@app/features/block-call/route-views';
import { PrDetailRouteView } from '@app/features/block-pr/route-views';
import { CalendarRouteView } from '@app/features/calendar-view/route-views';
import { ChannelInviteAcceptance } from '@app/features/channel-invitations/ChannelInviteAcceptance';
import { ChannelDetailRouteView } from '@app/features/channels-view/channels-view';
import { ChannelsRouteView } from '@app/features/channels-view/route-views';
import { CompaniesRouteView } from '@app/features/crm/route-views';
import { DriveDetailView } from '@app/features/drive-view/components/DriveDetailView';
import {
  DriveCallRouteView,
  DriveRouteView,
} from '@app/features/drive-view/route-views';
import { EmailDetailRouteView } from '@app/features/email-view/components/EmailDetailView';
import { MailRouteView } from '@app/features/email-view/route-views';
import { GettingStartedRouteView } from '@app/features/getting-started/route-views';
import { InviteLinksPortal } from '@app/features/gtm-invite/InviteLinksPortal';
import { InviteWelcome } from '@app/features/gtm-invite/InviteWelcome';
import { HomeEntityDetailRouteView } from '@app/features/home/components/HomeEntityDetailRouteView';
import { HomeReminderDetailRouteView } from '@app/features/home/components/HomeReminderDetailRouteView';
import {
  HomeCalendarRouteView,
  HomeDetailRouteView,
} from '@app/features/home/home-view';
import { HomeRouteView } from '@app/features/home/route-views';
import { MeetingRouter } from '@app/features/meetings/meeting-router';
import {
  CallsRouteView,
  FoldersRouteView,
  RecentRouteView,
  SearchRouteView,
} from '@app/features/next-soup/route-views';
import MobileWebSignup from '@app/features/onboarding/MobileWebSignup';
import {
  ReminderDetailRouteView,
  RemindersRouteView,
} from '@app/features/reminders/route-views';
import {
  ReviewsPrDetailRouteView,
  ReviewsRouteView,
} from '@app/features/reviews-view/route-views';
import { SettingsRouteView } from '@app/features/settings/route-views';
import { TasksDetailRouteView } from '@app/features/tasks-view/components/TasksDetailView';
import {
  ProjectDetailRouteView,
  ProjectTaskRouteView,
  TasksRouteView,
} from '@app/features/tasks-view/route-views';
import { TeamInviteAcceptance } from '@app/features/team-invitations/TeamInviteAcceptance';
import {
  createMemoryPaneStore,
  SplitRouter,
  useSolidRouterHistory,
} from '@app/lib/split-router';
import { globalSplitManager } from '@app/signal/splitLayout';
import { SplitLayout } from '@components/app/split-layout/SplitLayout';
import { createAppSplitRouterMiddleware } from '@components/app/split-layout/split-router/app-middleware';
import { createAppPanePolicy } from '@components/app/split-layout/split-router/app-pane-policy';
import {
  splitContentFromLocation,
  upgradeLegacyPath,
} from '@components/app/split-layout/split-router/legacy-route';
import NotFound from '@core/component/AccessErrorViews/NotFound';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { isTauri } from '@core/util/platform';
import { transformShortIdInUrlPathname } from '@core/util/url';
import { lazy } from 'solid-js';
import { paneRoute } from './app-route';
import { BasePathComponent } from './BasePath';
import {
  BookingReceiptRoutePage,
  EmailCallback,
  EmailLinkCallback,
  LoginPage,
  LoginPopupSuccess,
  OnboardingPage,
  PublicBookingRoutePage,
  SetupPage,
  SignupPage,
  TaskSlugPage,
  WelcomePage,
} from './pages';
import {
  activityRoute,
  agentChatsRoute,
  agentsRoute,
  agentsViewRoute,
  appRoute,
  baseRoute,
  bookingReceiptRoute,
  calendarSplitRoute,
  callDetailRoute,
  callsRoute,
  channelDetailRoute,
  channelInviteRoute,
  channelsSplitRoute,
  codersRoute,
  companiesRoute,
  debugRoutes,
  driveCallRoute,
  driveFolderDocumentRoute,
  driveFolderRoute,
  driveRootDocumentRoute,
  driveSplitRoute,
  driveTabDocumentRoute,
  driveTabRoute,
  emailSignupCallbackRoute,
  emailSplitRoute,
  emailThreadRoute,
  foldersRoute,
  gettingStartedRoute,
  homeCalendarRoute,
  homeChannelRoute,
  homeDocumentRoute,
  homePreviewRoute,
  homeReminderRoute,
  homeSplitRoute,
  inboxLinkCallbackRoute,
  internalInviteLinksRoute,
  inviteRoute,
  legacyContentRoute,
  loginPopupSuccessRoute,
  loginRoute,
  meetRoute,
  mobileEmailSignupRoute,
  notFoundRoute,
  onboardingRoute,
  prDetailRoute,
  projectDetailRoute,
  projectTaskRoute,
  publicBookingRoute,
  recentRoute,
  reminderDetailRoute,
  remindersRoute,
  reviewsPrRoute,
  reviewsSplitRoute,
  searchRoute,
  settingsRoute,
  setupRoute,
  signupRoute,
  taskDetailRoute,
  taskSlugRoute,
  tasksProjectsRoute,
  tasksSplitRoute,
  teamInviteRoute,
  welcomeRoute,
} from './routes';

const { Router, Route } = SplitRouter;

/** Debug views stay behind the registry's lazy import. */
function debugView(componentId: string) {
  return lazy(async () => {
    const { resolveComponent } = await import(
      '@components/app/split-layout/componentRegistry'
    );
    return { default: () => resolveComponent(componentId).element() };
  });
}

/** The app's router: the first pane's top-level route renders here, and app URLs render the split layout. */
export function AppRouterView() {
  const debugRouteElements = debugRoutes.map(({ componentId, route }) => (
    <Route definition={route} component={debugView(componentId)} />
  ));

  return (
    <Router
      history={(routes) =>
        useSolidRouterHistory({
          base: ROUTER_BASE,
          mode: isTauri() ? 'hash' : 'path',
          transformPath: (path) =>
            upgradeLegacyPath(routes, transformShortIdInUrlPathname(path)),
        })
      }
      paneStore={createMemoryPaneStore()}
      policy={createAppPanePolicy({
        manager: globalSplitManager,
        toContent: splitContentFromLocation,
        defaultLocation: () => ({
          route: paneRoute({ id: 'view-home', params: {} }),
        }),
        stacked: isNativeMobilePlatform,
      })}
      middleware={createAppSplitRouterMiddleware({ isTouchDevice })}
      globalSearch={['referral_code']}
      defaultRoute={() => ({ matches: [{ id: baseRoute.id, params: {} }] })}
    >
      <Route definition={baseRoute} component={BasePathComponent} />
      <Route
        definition={publicBookingRoute}
        component={PublicBookingRoutePage}
      />
      <Route
        definition={bookingReceiptRoute}
        component={BookingReceiptRoutePage}
      />
      <Route definition={meetRoute} component={MeetingRouter} />
      <Route definition={taskSlugRoute} component={TaskSlugPage} />
      <Route definition={signupRoute} component={SignupPage} />
      <Route definition={emailSignupCallbackRoute} component={EmailCallback} />
      <Route
        definition={inboxLinkCallbackRoute}
        component={EmailLinkCallback}
      />
      <Route
        definition={loginPopupSuccessRoute}
        component={LoginPopupSuccess}
      />
      <Route definition={loginRoute} component={LoginPage} />
      <Route definition={welcomeRoute} component={WelcomePage} />
      <Route definition={mobileEmailSignupRoute} component={MobileWebSignup} />
      <Route definition={onboardingRoute} component={OnboardingPage} />
      <Route definition={setupRoute} component={SetupPage} />
      <Route definition={inviteRoute} component={InviteWelcome} />
      <Route
        definition={internalInviteLinksRoute}
        component={InviteLinksPortal}
      />
      <Route definition={teamInviteRoute} component={TeamInviteAcceptance} />
      <Route
        definition={channelInviteRoute}
        component={ChannelInviteAcceptance}
      />

      <Route definition={appRoute} component={SplitLayout}>
        <Route definition={driveSplitRoute} component={DriveRouteView}>
          <Route definition={driveFolderRoute}>
            <Route
              definition={driveFolderDocumentRoute}
              component={DriveDetailView}
            />
          </Route>
          <Route definition={driveTabRoute}>
            <Route
              definition={driveTabDocumentRoute}
              component={DriveDetailView}
            />
          </Route>
          <Route definition={driveCallRoute} component={DriveCallRouteView} />
          <Route
            definition={driveRootDocumentRoute}
            component={DriveDetailView}
          />
        </Route>
        <Route definition={settingsRoute} component={SettingsRouteView} />
        <Route definition={agentsRoute} component={AgentsRouteView} />
        <Route definition={codersRoute} component={AgentsRouteView} />
        <Route definition={agentChatsRoute} component={AgentsRouteView} />
        <Route definition={homeSplitRoute} component={HomeRouteView}>
          {/* The period path is matched before the block pattern can claim `calendar`. */}
          <Route
            definition={homeCalendarRoute}
            component={HomeCalendarRouteView}
          />
          <Route
            definition={homeChannelRoute}
            component={HomeEntityDetailRouteView}
          />
          <Route
            definition={homeDocumentRoute}
            component={HomeEntityDetailRouteView}
          />
          <Route
            definition={homeReminderRoute}
            component={HomeReminderDetailRouteView}
          />
          <Route
            definition={homePreviewRoute}
            component={HomeDetailRouteView}
          />
        </Route>
        <Route
          definition={gettingStartedRoute}
          component={GettingStartedRouteView}
        />
        <Route definition={recentRoute} component={RecentRouteView} />
        <Route definition={activityRoute} component={ActivityRouteView} />
        <Route
          definition={reminderDetailRoute}
          component={ReminderDetailRouteView}
        />
        <Route definition={remindersRoute} component={RemindersRouteView} />
        <Route definition={agentsViewRoute} component={AgentsRouteView} />
        <Route definition={emailSplitRoute} component={MailRouteView}>
          <Route
            definition={emailThreadRoute}
            component={EmailDetailRouteView}
          />
        </Route>
        <Route definition={tasksSplitRoute} component={TasksRouteView}>
          <Route
            definition={projectDetailRoute}
            component={ProjectDetailRouteView}
          >
            <Route
              definition={projectTaskRoute}
              component={ProjectTaskRouteView}
            />
          </Route>
          <Route definition={tasksProjectsRoute} />
          <Route
            definition={taskDetailRoute}
            component={TasksDetailRouteView}
          />
        </Route>
        <Route definition={reviewsSplitRoute} component={ReviewsRouteView}>
          <Route
            definition={reviewsPrRoute}
            component={ReviewsPrDetailRouteView}
          />
        </Route>
        <Route definition={calendarSplitRoute} component={CalendarRouteView} />
        <Route definition={channelsSplitRoute} component={ChannelsRouteView}>
          <Route
            definition={channelDetailRoute}
            component={ChannelDetailRouteView}
          />
        </Route>
        <Route definition={callsRoute} component={CallsRouteView} />
        <Route definition={callDetailRoute} component={CallDetailRouteView} />
        <Route definition={companiesRoute} component={CompaniesRouteView} />
        <Route definition={foldersRoute} component={FoldersRouteView} />
        <Route definition={searchRoute} component={SearchRouteView} />
        <Route definition={prDetailRoute} component={PrDetailRouteView} />
        {debugRouteElements}
        {/* Renders the split's legacy mount, so it has no component. */}
        <Route definition={legacyContentRoute} />
        <Route definition={notFoundRoute} component={NotFound} />
      </Route>
    </Router>
  );
}
