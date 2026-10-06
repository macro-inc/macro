import { ROUTER_BASE } from '@app/constants/routerBase';
import {
  HomeCalendarRouteView,
  HomeDetailRouteView,
} from '@app/features/home/home-view';
import { HomeRouteView } from '@app/features/home/route-views';
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
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { lazyNamed } from '@core/util/lazyNamed';
import { isTauri } from '@core/util/platform';
import { transformShortIdInUrlPathname } from '@core/util/url';
import { lazy, onMount } from 'solid-js';
import { paneRoute } from './app-route';
import { BasePathComponent } from './BasePath';
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

const { Router, Route } = SplitRouter;

/**
 * Every view except Home (the default landing) loads as its own chunk. The
 * split router warms a route's chunks while it navigates, and
 * `prefetchRouteViews` fetches them once the first screen has settled.
 */
const ActivityRouteView = lazyNamed(
  () => import('@app/features/activity/route-views'),
  'ActivityRouteView'
);
const AgentsRouteView = lazyNamed(
  () => import('@app/features/agents-view/route-views'),
  'AgentsRouteView'
);
const MobileWebSignup = lazyNamed(
  () => import('@app/features/auth/auth'),
  'MobileWebSignup'
);
const CallDetailRouteView = lazyNamed(
  () => import('@app/features/block-call/route-views'),
  'CallDetailRouteView'
);
const PrDetailRouteView = lazyNamed(
  () => import('@app/features/block-pr/route-views'),
  'PrDetailRouteView'
);
const CalendarRouteView = lazyNamed(
  () => import('@app/features/calendar-view/route-views'),
  'CalendarRouteView'
);
const ChannelInviteAcceptance = lazyNamed(
  () => import('@app/features/channel-invitations/ChannelInviteAcceptance'),
  'ChannelInviteAcceptance'
);
const ChannelDetailRouteView = lazyNamed(
  () => import('@app/features/channels-view/channels-view'),
  'ChannelDetailRouteView'
);
const ChannelsRouteView = lazyNamed(
  () => import('@app/features/channels-view/route-views'),
  'ChannelsRouteView'
);
const CompaniesRouteView = lazyNamed(
  () => import('@app/features/crm/route-views'),
  'CompaniesRouteView'
);
const DriveDetailView = lazyNamed(
  () => import('@app/features/drive-view/components/DriveDetailView'),
  'DriveDetailView'
);
const DriveCallRouteView = lazyNamed(
  () => import('@app/features/drive-view/route-views'),
  'DriveCallRouteView'
);
const DriveRouteView = lazyNamed(
  () => import('@app/features/drive-view/route-views'),
  'DriveRouteView'
);
const EmailDetailRouteView = lazyNamed(
  () => import('@app/features/email-view/components/EmailDetailView'),
  'EmailDetailRouteView'
);
const MailRouteView = lazyNamed(
  () => import('@app/features/email-view/route-views'),
  'MailRouteView'
);
const InviteLinksPortal = lazyNamed(
  () => import('@app/features/gtm-invite/InviteLinksPortal'),
  'InviteLinksPortal'
);
const InviteWelcome = lazyNamed(
  () => import('@app/features/gtm-invite/InviteWelcome'),
  'InviteWelcome'
);
const HomeEntityDetailRouteView = lazyNamed(
  () => import('@app/features/home/components/HomeEntityDetailRouteView'),
  'HomeEntityDetailRouteView'
);
const MeetingRouter = lazyNamed(
  () => import('@app/features/meetings/meeting-router'),
  'MeetingRouter'
);
const CallsRouteView = lazyNamed(
  () => import('@app/features/next-soup/route-views'),
  'CallsRouteView'
);
const FoldersRouteView = lazyNamed(
  () => import('@app/features/next-soup/route-views'),
  'FoldersRouteView'
);
const RecentRouteView = lazyNamed(
  () => import('@app/features/next-soup/route-views'),
  'RecentRouteView'
);
const SearchRouteView = lazyNamed(
  () => import('@app/features/next-soup/route-views'),
  'SearchRouteView'
);
const ReviewsPrDetailRouteView = lazyNamed(
  () => import('@app/features/reviews-view/route-views'),
  'ReviewsPrDetailRouteView'
);
const ReviewsRouteView = lazyNamed(
  () => import('@app/features/reviews-view/route-views'),
  'ReviewsRouteView'
);
const RoutineCreateRouteView = lazyNamed(
  () => import('@app/features/routines/route-views'),
  'RoutineCreateRouteView'
);
const SettingsRouteView = lazyNamed(
  () => import('@app/features/settings/route-views'),
  'SettingsRouteView'
);
const TasksDetailRouteView = lazyNamed(
  () => import('@app/features/tasks-view/components/TasksDetailView'),
  'TasksDetailRouteView'
);
const ProjectDetailRouteView = lazyNamed(
  () => import('@app/features/tasks-view/route-views'),
  'ProjectDetailRouteView'
);
const ProjectTaskRouteView = lazyNamed(
  () => import('@app/features/tasks-view/route-views'),
  'ProjectTaskRouteView'
);
const TasksRouteView = lazyNamed(
  () => import('@app/features/tasks-view/route-views'),
  'TasksRouteView'
);
const TeamInviteAcceptance = lazyNamed(
  () => import('@app/features/team-invitations/TeamInviteAcceptance'),
  'TeamInviteAcceptance'
);
const BookingReceiptRoutePage = lazyNamed(
  () => import('./pages'),
  'BookingReceiptRoutePage'
);
const EmailCallback = lazyNamed(() => import('./pages'), 'EmailCallback');
const EmailLinkCallback = lazyNamed(
  () => import('./pages'),
  'EmailLinkCallback'
);
const LoginPage = lazyNamed(() => import('./pages'), 'LoginPage');
const LoginPopupSuccess = lazyNamed(
  () => import('./pages'),
  'LoginPopupSuccess'
);
const OnboardingPage = lazyNamed(() => import('./pages'), 'OnboardingPage');
const PublicBookingRoutePage = lazyNamed(
  () => import('./pages'),
  'PublicBookingRoutePage'
);
const SignupPage = lazyNamed(() => import('./pages'), 'SignupPage');
const TaskSlugPage = lazyNamed(() => import('./pages'), 'TaskSlugPage');
const WelcomePage = lazyNamed(() => import('./pages'), 'WelcomePage');
const NotFound = lazy(
  () => import('@core/component/AccessErrorViews/NotFound')
);

/** Debug views stay behind the registry's lazy import. */
function debugView(componentId: string) {
  return lazy(async () => {
    const { resolveComponent } = await import(
      '@components/app/split-layout/componentRegistry'
    );
    return { default: () => resolveComponent(componentId).element() };
  });
}

/**
 * Views a session is likely to open next. Fetching them while the browser is
 * idle keeps the first navigation as fast as it was with one big bundle.
 */
const LIKELY_NEXT_VIEWS = [
  HomeEntityDetailRouteView,
  ChannelsRouteView,
  ChannelDetailRouteView,
  MailRouteView,
  EmailDetailRouteView,
  DriveRouteView,
  DriveDetailView,
  TasksRouteView,
  AgentsRouteView,
  CalendarRouteView,
];

/** Warms the likely-next view chunks one at a time, without competing with startup work. */
function prefetchRouteViews(): void {
  const idle = (run: () => void) =>
    'requestIdleCallback' in window
      ? window.requestIdleCallback(run, { timeout: 5000 })
      : setTimeout(run, 1000);
  const queue = [...LIKELY_NEXT_VIEWS];
  const next = () => {
    const view = queue.shift();
    if (!view) return;
    view
      .preload()
      .catch(() => {})
      .finally(() => idle(next));
  };
  // Leave the first seconds to the landing view's own data and chunks.
  setTimeout(() => idle(next), 2500);
}

/** The app's router: the first pane's top-level route renders here, and app URLs render the split layout. */
export function AppRouterView() {
  onMount(prefetchRouteViews);

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
