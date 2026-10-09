import { ROUTER_BASE } from '@app/constants/routerBase';
import { MobileWebSignup } from '@app/features/auth/auth';
import { ChannelInviteAcceptance } from '@app/features/channel-invitations/ChannelInviteAcceptance';
import { InviteLinksPortal } from '@app/features/gtm-invite/InviteLinksPortal';
import { InviteWelcome } from '@app/features/gtm-invite/InviteWelcome';
import {
  HomeCalendarRouteView,
  HomeDetailRouteView,
} from '@app/features/home/home-view';
import { HomeRouteView } from '@app/features/home/route-views';
import { TeamInviteAcceptance } from '@app/features/team-invitations/TeamInviteAcceptance';
import {
  createMemoryPaneStore,
  SplitRouter,
  useSolidRouterHistory,
} from '@app/lib/split-router';
import { globalSplitManager } from '@app/signal/splitLayout';
import { createAppSplitRouterMiddleware } from '@components/app/split-layout/split-router/app-middleware';
import { createAppPanePolicy } from '@components/app/split-layout/split-router/app-pane-policy';
import {
  splitContentFromLocation,
  upgradeLegacyPath,
} from '@components/app/split-layout/split-router/legacy-route';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { isTauri } from '@core/util/platform';
import { transformShortIdInUrlPathname } from '@core/util/url';
import { lazy } from 'solid-js';
import { paneRoute } from './app-route';
import { BasePathComponent } from './BasePath';
import {
  ActivityRouteView,
  AgentsRouteView,
  CalendarRouteView,
  CallDetailRouteView,
  CallsRouteView,
  ChannelDetailRouteView,
  ChannelsRouteView,
  CompaniesRouteView,
  DriveCallRouteView,
  DriveDetailView,
  DriveRouteView,
  EmailDetailRouteView,
  FoldersRouteView,
  FormRespondRoutePage,
  HomeEntityDetailRouteView,
  MailRouteView,
  MeetingRouter,
  NotFound,
  PrDetailRouteView,
  ProjectDetailRouteView,
  ProjectTaskRouteView,
  RecentRouteView,
  ReviewsPrDetailRouteView,
  ReviewsRouteView,
  RoutineCreateRouteView,
  SearchRouteView,
  SettingsRouteView,
  TasksDetailRouteView,
  TasksRouteView,
} from './lazy-route-views';
import {
  BookingReceiptRoutePage,
  EmailCallback,
  EmailLinkCallback,
  LoginPage,
  LoginPopupSuccess,
  OnboardingPage,
  PublicBookingRoutePage,
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
  authRoute,
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
  formRespondRoute,
  homeCalendarRoute,
  homeChannelRoute,
  homeDocumentRoute,
  homePreviewRoute,
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
  publicRoute,
  recentRoute,
  reviewsPrRoute,
  reviewsSplitRoute,
  routineCreateRoute,
  routineDetailRoute,
  routinesRoute,
  searchRoute,
  settingsRoute,
  signupRoute,
  taskDetailRoute,
  taskSlugRoute,
  tasksProjectsRoute,
  tasksSplitRoute,
  teamInviteRoute,
  welcomeRoute,
} from './routes';
import {
  AppShell,
  AuthShell,
  FocusedShell,
  withFormRespondShell,
  withMeetingShell,
} from './shells';

const { Router, Route } = SplitRouter;

// Views under appRoute load lazily (lazy-route-views.ts); auth and booking
// pages render outside it and load with the app.

/** Debug views stay behind the registry's lazy import. */
function debugView(componentId: string) {
  return lazy(async () => {
    const { resolveComponent } = await import(
      '@components/app/split-layout/componentRegistry'
    );
    return { default: () => resolveComponent(componentId).element() };
  });
}

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
      <Route definition={publicRoute} component={FocusedShell}>
        <Route
          definition={publicBookingRoute}
          component={PublicBookingRoutePage}
        />
        <Route
          definition={bookingReceiptRoute}
          component={BookingReceiptRoutePage}
        />
      </Route>
      <Route
        definition={formRespondRoute}
        component={withFormRespondShell(FormRespondRoutePage)}
      />
      <Route
        definition={meetRoute}
        component={withMeetingShell(MeetingRouter)}
      />
      <Route definition={authRoute} component={AuthShell}>
        <Route definition={taskSlugRoute} component={TaskSlugPage} />
        <Route definition={signupRoute} component={SignupPage} />
        <Route
          definition={emailSignupCallbackRoute}
          component={EmailCallback}
        />
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
        <Route
          definition={mobileEmailSignupRoute}
          component={MobileWebSignup}
        />
        <Route definition={onboardingRoute} component={OnboardingPage} />
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
      </Route>

      <Route definition={appRoute} component={AppShell}>
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
        <Route
          definition={routineCreateRoute}
          component={RoutineCreateRouteView}
        />
        <Route definition={routineDetailRoute} component={AgentsRouteView} />
        <Route definition={routinesRoute} component={AgentsRouteView} />
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
            definition={homePreviewRoute}
            component={HomeDetailRouteView}
          />
        </Route>
        <Route definition={recentRoute} component={RecentRouteView} />
        <Route definition={activityRoute} component={ActivityRouteView} />
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
